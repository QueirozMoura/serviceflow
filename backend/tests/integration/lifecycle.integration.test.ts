import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient, UserRole, type PaymentStatus, type QuoteStatus, type ServiceOrderStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas). Concorrencia = app.inject em Promise.all contra o
// pool real do Prisma, entao locks e transacoes sao exercitados de verdade.
const temporary: TemporaryDatabase = createTemporaryDatabase('lifecycle');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { PrismaQuoteRepository } = await import('../../src/modules/quotes/repository.js');
const { PrismaServiceOrderRepository } = await import('../../src/modules/service-orders/repository.js');
const { makeOrganizationSlug } = await import('../../src/modules/auth/service.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { env } = await import('../../src/config/env.js');

describe('service order lifecycle against a real PostgreSQL database', () => {
  let db: PrismaClient;
  let auth: InstanceType<typeof PrismaAuthRepository>;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: temporary.url } } });
    auth = new PrismaAuthRepository(db);
    app = buildApp({ authRepository: auth });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    temporary.drop();
  }, 60_000);

  let counter = 0;
  async function cookieFor(userId: string, organizationId: string) {
    const { token, tokenHash } = createSessionToken();
    await auth.createSession({ tokenHash, userId, organizationId, expiresAt: sessionExpiresAt() });
    return { id: userId, cookie: `${env.AUTH_COOKIE_NAME}=${token}` };
  }
  async function organization(name: string) {
    const { user } = await auth.createOrganizationWithOwner({ organizationName: `Org ${name}`, slug: makeOrganizationSlug(`Org ${name}`), name: `${name} Owner`, email: `${name.toLowerCase()}-owner@example.com`, passwordHash: await bcrypt.hash('StrongPass1', 4) });
    const organizationId = user.organizationId;
    const member = async (role: UserRole, label: string) => {
      const created = await db.user.create({ data: { organizationId, name: `${label} ${name}`, email: `${label.toLowerCase()}-${name.toLowerCase()}@example.com`, role } });
      return cookieFor(created.id, organizationId);
    };
    return { organizationId, owner: await cookieFor(user.id, organizationId), admin: await member(UserRole.ADMIN, 'Admin'), technician: await member(UserRole.TECHNICIAN, 'Tecnico') };
  }
  type Org = Awaited<ReturnType<typeof organization>>;
  type Actor = { id: string; cookie: string };

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, actor: Actor, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { cookie: actor.cookie, ...headers }, ...(payload ? { payload } : {}) });

  async function order(org: Org, options: { status?: ServiceOrderStatus; finalValue?: string } = {}) {
    const customer = await db.customer.create({ data: { organizationId: org.organizationId, name: 'Cliente', phone: '5511-0000' } });
    const equipment = await db.equipment.create({ data: { organizationId: org.organizationId, customerId: customer.id, type: 'Notebook' } });
    return db.serviceOrder.create({ data: { organizationId: org.organizationId, customerId: customer.id, equipmentId: equipment.id, orderNumber: `OS-${++counter}-${org.organizationId.slice(0, 6)}`, status: options.status ?? 'RECEIVED', problemDescription: 'x', receivedAt: new Date(), ...(options.finalValue ? { finalValue: options.finalValue } : {}) } });
  }
  const quote = (serviceOrderId: string, status: QuoteStatus, total = '100.00') =>
    db.quote.create({ data: { serviceOrderId, status, total, items: { create: [{ description: 'Servico', quantity: '1', unitPrice: total, type: 'LABOR' }] } }, include: { items: true } });
  const payment = (org: Org, serviceOrderId: string, status: PaymentStatus, amount = '100.00') =>
    db.payment.create({ data: { organizationId: org.organizationId, serviceOrderId, amount, status, method: 'PIX' } });

  const setStatus = (actor: Actor, id: string, status: string) => call('PATCH', `/api/service-orders/${id}/status`, actor, { status });
  const decideQuote = (actor: Actor, id: string, status: string) => call('PATCH', `/api/service-orders/${id}/quote/status`, actor, { status });
  const pay = (actor: Actor, id: string, amount: string, key: string = randomUUID()) => call('POST', `/api/service-orders/${id}/payments`, actor, { amount, method: 'PIX' }, { 'idempotency-key': key });
  const payStatus = (actor: Actor, id: string, paymentId: string, status: string) => call('PATCH', `/api/service-orders/${id}/payments/${paymentId}/status`, actor, { status });
  const statusOf = async (id: string) => (await db.serviceOrder.findUniqueOrThrow({ where: { id } })).status;
  const history = (id: string) => db.serviceOrderStatusHistory.findMany({ where: { serviceOrderId: id }, orderBy: { createdAt: 'asc' } });

  /** O historico gravado e uma cadeia sem buracos e termina no status real da OS. */
  async function expectCoherentHistory(id: string, rows = 1) {
    const entries = await history(id);
    expect(entries.length).toBeGreaterThanOrEqual(rows);
    for (let index = 1; index < entries.length; index += 1) expect(entries[index]!.fromStatus).toBe(entries[index - 1]!.toStatus);
    if (entries.length > 0) expect(entries.at(-1)!.toStatus).toBe(await statusOf(id));
    return entries;
  }

  describe('status transitions', () => {
    it('walks the whole valid path, recording exactly one history row per change', async () => {
      const org = await organization('Walk'); const so = await order(org);
      for (const next of ['WAITING_DIAGNOSIS', 'WAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'READY', 'DELIVERED']) {
        const response = await setStatus(org.admin, so.id, next);
        expect(response.statusCode, next).toBe(200);
        expect(response.json().serviceOrder.status).toBe(next);
      }
      const entries = await expectCoherentHistory(so.id);
      expect(entries.map((entry) => entry.toStatus)).toEqual(['WAITING_DIAGNOSIS', 'WAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'READY', 'DELIVERED']);
      expect((await db.serviceOrder.findUniqueOrThrow({ where: { id: so.id } })).completedAt).not.toBeNull();
    });

    it('rejects invalid jumps, repetitions and any move out of a terminal state, writing nothing', async () => {
      const org = await organization('Invalid');
      const cases: Array<[ServiceOrderStatus, string]> = [['RECEIVED', 'DELIVERED'], ['RECEIVED', 'RECEIVED'], ['RECEIVED', 'IN_PROGRESS'], ['IN_PROGRESS', 'APPROVED'], ['DELIVERED', 'CANCELLED'], ['DELIVERED', 'READY'], ['CANCELLED', 'RECEIVED'], ['CANCELLED', 'WAITING_DIAGNOSIS']];
      for (const [from, to] of cases) {
        const so = await order(org, { status: from });
        const response = await setStatus(org.owner, so.id, to);
        expect(response.statusCode, `${from} -> ${to}`).toBe(409);
        expect(response.json().message).toBe('Invalid service order status transition');
        expect(await statusOf(so.id)).toBe(from);
        expect(await history(so.id)).toHaveLength(0);
      }
    });
  });

  describe('delivery and balance', () => {
    it('refuses delivery while a confirmed amount does not cover the amount due, or a payment is still pending', async () => {
      const org = await organization('Deliver'); const so = await order(org, { status: 'READY', finalValue: '100.00' });
      await payment(org, so.id, 'PAID', '60.00');
      const open = await setStatus(org.owner, so.id, 'DELIVERED');
      expect(open.statusCode).toBe(409);
      expect(open.json().message).toMatch(/open balance or pending payments/);

      const pending = await payment(org, so.id, 'PENDING', '40.00');
      expect((await setStatus(org.owner, so.id, 'DELIVERED')).statusCode).toBe(409);
      expect(await statusOf(so.id)).toBe('READY');
      expect(await history(so.id)).toHaveLength(0);
      expect((await db.serviceOrder.findUniqueOrThrow({ where: { id: so.id } })).completedAt).toBeNull();

      expect((await payStatus(org.owner, so.id, pending.id, 'PAID')).statusCode).toBe(200);
      expect((await setStatus(org.technician, so.id, 'DELIVERED')).statusCode).toBe(200);
      expect(await statusOf(so.id)).toBe('DELIVERED');
    });

    it('uses an approved quote as the amount due and ignores payments that were released', async () => {
      const org = await organization('DeliverQuote'); const so = await order(org, { status: 'READY' });
      await quote(so.id, 'APPROVED', '80.00');
      await payment(org, so.id, 'PAID', '30.00'); await payment(org, so.id, 'CANCELLED', '50.00');
      expect((await setStatus(org.owner, so.id, 'DELIVERED')).statusCode).toBe(409);
      await payment(org, so.id, 'PAID', '50.00');
      expect((await setStatus(org.owner, so.id, 'DELIVERED')).statusCode).toBe(200);
    });

    it('delivers an order with no amount due and no payments (nothing to settle)', async () => {
      const org = await organization('DeliverFree'); const so = await order(org, { status: 'READY' });
      expect((await setStatus(org.owner, so.id, 'DELIVERED')).statusCode).toBe(200);
    });

    it('does not let a pending quote or an estimate stand in for the amount due when delivering', async () => {
      const org = await organization('DeliverPendingQuote'); const so = await order(org, { status: 'READY' });
      await quote(so.id, 'PENDING', '80.00');
      await db.serviceOrder.update({ where: { id: so.id }, data: { estimatedValue: '500.00' } });
      expect((await setStatus(org.owner, so.id, 'DELIVERED')).statusCode).toBe(200);
    });
  });

  describe('cancellation and paid payments', () => {
    it('refuses to cancel with a confirmed payment until it is refunded, then allows it', async () => {
      const org = await organization('Cancel'); const so = await order(org, { status: 'IN_PROGRESS', finalValue: '100.00' });
      const paid = await payment(org, so.id, 'PAID', '100.00');
      const refused = await setStatus(org.owner, so.id, 'CANCELLED');
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toMatch(/refund them before cancelling/);
      expect(await statusOf(so.id)).toBe('IN_PROGRESS'); expect(await history(so.id)).toHaveLength(0);

      expect((await payStatus(org.owner, so.id, paid.id, 'REFUNDED')).statusCode).toBe(200);
      expect((await setStatus(org.owner, so.id, 'CANCELLED')).statusCode).toBe(200);
      expect(await statusOf(so.id)).toBe('CANCELLED');
    });

    it('keeps the technician from cancelling at all', async () => {
      const org = await organization('CancelTech'); const so = await order(org, { status: 'RECEIVED' });
      expect((await setStatus(org.technician, so.id, 'CANCELLED')).statusCode).toBe(403);
      expect(await statusOf(so.id)).toBe('RECEIVED');
    });
  });

  describe('approval requires an approved quote', () => {
    it('blocks approving the order while its quote is pending, rejected or expired, and allows it once approved', async () => {
      const org = await organization('Approve');
      for (const status of ['PENDING', 'REJECTED', 'EXPIRED'] as const) {
        const so = await order(org, { status: 'WAITING_APPROVAL' }); await quote(so.id, status);
        const response = await setStatus(org.admin, so.id, 'APPROVED');
        expect(response.statusCode, status).toBe(409);
        expect(response.json().message).toBe('Service order approval requires an approved quote');
        expect(await statusOf(so.id)).toBe('WAITING_APPROVAL'); expect(await history(so.id)).toHaveLength(0);
      }
      const ok = await order(org, { status: 'WAITING_APPROVAL' }); await quote(ok.id, 'APPROVED');
      expect((await setStatus(org.admin, ok.id, 'APPROVED')).statusCode).toBe(200);
    });

    it('keeps the current behaviour for an order without any quote: it can be approved directly', async () => {
      const org = await organization('ApproveNoQuote'); const so = await order(org, { status: 'WAITING_APPROVAL' });
      expect((await setStatus(org.owner, so.id, 'APPROVED')).statusCode).toBe(200);
    });

    it('approving the quote moves an order that is waiting for approval to APPROVED atomically, attributing the history to the approver', async () => {
      const org = await organization('AutoAdvance'); const so = await order(org, { status: 'WAITING_APPROVAL' }); await quote(so.id, 'PENDING');
      const response = await decideQuote(org.admin, so.id, 'APPROVED');
      expect(response.statusCode).toBe(200);
      expect(response.json().quote.status).toBe('APPROVED');
      expect(response.json().quote.serviceOrder.status).toBe('APPROVED');
      expect(await statusOf(so.id)).toBe('APPROVED');
      const entries = await history(so.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ fromStatus: 'WAITING_APPROVAL', toStatus: 'APPROVED', changedByUserId: org.admin.id, organizationId: org.organizationId });
    });

    it('does not touch the order when it is not waiting for approval, or when the quote is rejected or expired', async () => {
      const org = await organization('NoAdvance');
      for (const status of ['RECEIVED', 'WAITING_DIAGNOSIS', 'IN_PROGRESS'] as const) {
        const so = await order(org, { status }); await quote(so.id, 'PENDING');
        expect((await decideQuote(org.owner, so.id, 'APPROVED')).statusCode).toBe(200);
        expect(await statusOf(so.id)).toBe(status); expect(await history(so.id)).toHaveLength(0);
      }
      for (const decision of ['REJECTED', 'EXPIRED']) {
        const so = await order(org, { status: 'WAITING_APPROVAL' }); await quote(so.id, 'PENDING');
        expect((await decideQuote(org.owner, so.id, decision)).statusCode).toBe(200);
        expect(await statusOf(so.id)).toBe('WAITING_APPROVAL');
      }
    });

    it('rolls the quote decision back when the automatic order change cannot be recorded', async () => {
      const org = await organization('AdvanceRollback'); const so = await order(org, { status: 'WAITING_APPROVAL' }); await quote(so.id, 'PENDING');
      const failing = new PrismaQuoteRepository(new Proxy(db, {
        get: (target, property) => property !== '$transaction' ? Reflect.get(target, property) : (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction((client) => callback(new Proxy(client, {
          get: (inner, name) => name !== 'serviceOrderStatusHistory' ? Reflect.get(inner, name) : new Proxy(inner.serviceOrderStatusHistory, { get: (delegate, operation) => operation === 'create' ? () => { throw new Error('simulated failure'); } : (Reflect.get(delegate, operation) as (...args: unknown[]) => unknown).bind(delegate) }),
        }))),
      }) as PrismaClient);

      await expect(failing.updateStatus(org.organizationId, so.id, 'APPROVED', { userId: org.admin.id, advanceServiceOrder: true })).rejects.toThrow('simulated failure');
      expect((await db.quote.findUniqueOrThrow({ where: { serviceOrderId: so.id } })).status).toBe('PENDING');
      expect(await statusOf(so.id)).toBe('WAITING_APPROVAL');
      expect(await history(so.id)).toHaveLength(0);
    });

    it('rolls an order status change back when its history row cannot be written', async () => {
      const org = await organization('StatusRollback'); const so = await order(org, { status: 'READY' });
      const failing = new PrismaServiceOrderRepository(new Proxy(db, {
        get: (target, property) => property !== '$transaction' ? Reflect.get(target, property) : (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction((client) => callback(new Proxy(client, {
          get: (inner, name) => name !== 'serviceOrderStatusHistory' ? Reflect.get(inner, name) : new Proxy(inner.serviceOrderStatusHistory, { get: (delegate, operation) => operation === 'create' ? () => { throw new Error('simulated failure'); } : (Reflect.get(delegate, operation) as (...args: unknown[]) => unknown).bind(delegate) }),
        }))),
      }) as PrismaClient);
      await expect(failing.updateStatus(org.organizationId, so.id, org.owner.id, 'DELIVERED')).rejects.toThrow('simulated failure');
      const row = await db.serviceOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(row.status).toBe('READY'); expect(row.completedAt).toBeNull();
    });
  });

  describe('delivered and cancelled orders are frozen', () => {
    for (const terminal of ['DELIVERED', 'CANCELLED'] as const) {
      it(`blocks every operational and financial change on a ${terminal} order and keeps its data intact`, async () => {
        const org = await organization(`Frozen${terminal}`);
        const so = await order(org, { status: terminal, finalValue: '100.00' });
        const q = await quote(so.id, 'PENDING', '100.00'); const itemId = q.items[0]!.id;
        await db.diagnosis.create({ data: { serviceOrderId: so.id, description: 'Fonte' } });
        const pendingPayment = await payment(org, so.id, 'PENDING', '10.00');
        const before = { order: await db.serviceOrder.findUniqueOrThrow({ where: { id: so.id } }), items: await db.serviceItem.count({ where: { quoteId: q.id } }), payments: await db.payment.count({ where: { serviceOrderId: so.id } }) };

        const attempts: Array<[string, Awaited<ReturnType<typeof call>>]> = [
          ['patch order', await call('PATCH', `/api/service-orders/${so.id}`, org.owner, { technicianNotes: 'depois' })],
          ['patch order value', await call('PATCH', `/api/service-orders/${so.id}`, org.owner, { finalValue: '1.00' })],
          ['create diagnosis', await call('POST', `/api/service-orders/${so.id}/diagnosis`, org.owner, { description: 'Outro' })],
          ['patch diagnosis', await call('PATCH', `/api/service-orders/${so.id}/diagnosis`, org.owner, { description: 'Mudou' })],
          ['delete diagnosis', await call('DELETE', `/api/service-orders/${so.id}/diagnosis`, org.owner)],
          ['patch quote', await call('PATCH', `/api/service-orders/${so.id}/quote`, org.owner, { notes: 'x' })],
          ['decide quote', await decideQuote(org.owner, so.id, 'APPROVED')],
          ['add item', await call('POST', `/api/service-orders/${so.id}/quote/items`, org.owner, { description: 'N', quantity: '1', unitPrice: '5.00', type: 'PART' })],
          ['patch item', await call('PATCH', `/api/service-orders/${so.id}/quote/items/${itemId}`, org.owner, { unitPrice: '1.00' })],
          ['delete item', await call('DELETE', `/api/service-orders/${so.id}/quote/items/${itemId}`, org.owner)],
          ['delete quote', await call('DELETE', `/api/service-orders/${so.id}/quote`, org.owner)],
          ['create payment', await pay(org.owner, so.id, '5.00')],
          ['patch payment', await call('PATCH', `/api/service-orders/${so.id}/payments/${pendingPayment.id}`, org.owner, { amount: '6.00' })],
          ['delete payment', await call('DELETE', `/api/service-orders/${so.id}/payments/${pendingPayment.id}`, org.owner)],
          ['confirm payment', await payStatus(org.owner, so.id, pendingPayment.id, 'PAID')],
        ];
        for (const [label, response] of attempts) {
          expect(response.statusCode, label).toBe(409);
          expect(response.json().message, label).toBe('Service order is delivered or cancelled and can no longer be changed');
        }

        const after = { order: await db.serviceOrder.findUniqueOrThrow({ where: { id: so.id } }), items: await db.serviceItem.count({ where: { quoteId: q.id } }), payments: await db.payment.count({ where: { serviceOrderId: so.id } }) };
        expect(after.order).toEqual(before.order);
        expect(after.items).toBe(before.items); expect(after.payments).toBe(before.payments);
        expect((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('PENDING');
        expect((await db.diagnosis.findUniqueOrThrow({ where: { serviceOrderId: so.id } })).description).toBe('Fonte');
        expect((await db.payment.findUniqueOrThrow({ where: { id: pendingPayment.id } })).status).toBe('PENDING');
      });
    }

    it('still lets a terminal order be regularised: releasing transitions, refunds, reads, warranty and message drafts', async () => {
      const org = await organization('Regularise');
      const delivered = await order(org, { status: 'DELIVERED', finalValue: '100.00' });
      const paid = await payment(org, delivered.id, 'PAID', '100.00');
      const cancelled = await order(org, { status: 'CANCELLED', finalValue: '100.00' });
      const pending = await payment(org, cancelled.id, 'PENDING', '40.00');

      expect((await payStatus(org.owner, delivered.id, paid.id, 'REFUNDED')).statusCode).toBe(200);
      expect((await payStatus(org.owner, cancelled.id, pending.id, 'CANCELLED')).statusCode).toBe(200);
      expect((await call('GET', `/api/service-orders/${delivered.id}/payments`, org.owner)).statusCode).toBe(200);
      expect((await call('GET', `/api/service-orders/${cancelled.id}`, org.technician)).statusCode).toBe(200);
      const warranty = await call('POST', `/api/service-orders/${delivered.id}/warranty`, org.technician, { startDate: '2026-10-01', endDate: '2027-01-01', description: 'Garantia do servico' });
      expect(warranty.statusCode).toBe(201);
      expect((await call('POST', `/api/service-orders/${delivered.id}/messages/history`, org.technician, { type: 'SERVICE_DELIVERED', channel: 'WHATSAPP' })).statusCode).toBe(201);
    });

    it('answers a repeated payment request with the original record even after the order was delivered', async () => {
      const org = await organization('ReplayFrozen'); const so = await order(org, { status: 'READY', finalValue: '100.00' });
      const key = 'op-replay-frozen-0001';
      const first = await pay(org.owner, so.id, '100.00', key);
      expect(first.statusCode).toBe(201);
      await payStatus(org.owner, so.id, first.json().payment.id, 'PAID');
      expect((await setStatus(org.owner, so.id, 'DELIVERED')).statusCode).toBe(200);

      const replay = await pay(org.owner, so.id, '100.00', key);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().payment.id).toBe(first.json().payment.id);
      expect((await pay(org.owner, so.id, '100.00', 'op-replay-frozen-0002')).statusCode).toBe(409);
      expect(await db.payment.count({ where: { serviceOrderId: so.id } })).toBe(1);
    });
  });

  describe('who may change money', () => {
    it('keeps the technician from setting values on creation or changing them afterwards, while ADMIN and OWNER can', async () => {
      const org = await organization('Money'); const so = await order(org, { status: 'RECEIVED', finalValue: '100.00' });
      await db.serviceOrder.update({ where: { id: so.id }, data: { estimatedValue: '90.00' } });
      const url = `/api/service-orders/${so.id}`;

      // O formulario reenvia os valores atuais ao editar outros campos: isso nao e alterar valor.
      expect((await call('PATCH', url, org.technician, { technicianNotes: 'ok', finalValue: '100.00', estimatedValue: '90' })).statusCode).toBe(200);
      for (const body of [{ finalValue: '101.00' }, { estimatedValue: '1.00' }, { finalValue: null }, { estimatedValue: null }]) {
        const response = await call('PATCH', url, org.technician, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(403);
      }
      const row = await db.serviceOrder.findUniqueOrThrow({ where: { id: so.id } });
      expect(row.finalValue?.toString()).toBe('100'); expect(row.estimatedValue?.toString()).toBe('90'); expect(row.technicianNotes).toBe('ok');

      const customerId = so.customerId; const equipmentId = so.equipmentId;
      const create = (actor: Actor, extra: object) => call('POST', '/api/service-orders', actor, { customerId, equipmentId, problemDescription: 'Nao liga', ...extra });
      expect((await create(org.technician, { finalValue: '10.00' })).statusCode).toBe(403);
      expect((await create(org.technician, { estimatedValue: '10.00' })).statusCode).toBe(403);
      expect((await create(org.technician, { estimatedValue: null, finalValue: null })).statusCode).toBe(201);
      expect((await create(org.admin, { estimatedValue: '10.00', finalValue: '20.00' })).statusCode).toBe(201);
      expect((await call('PATCH', url, org.admin, { finalValue: '120.00' })).statusCode).toBe(200);
      expect((await call('PATCH', url, org.owner, { estimatedValue: '95.00' })).statusCode).toBe(200);
    });

    it('keeps the technician from creating, removing or repricing quote items, but allows descriptive edits', async () => {
      const org = await organization('Prices'); const so = await order(org, { status: 'RECEIVED' });
      const q = await quote(so.id, 'PENDING', '100.00'); const itemId = q.items[0]!.id;
      const base = `/api/service-orders/${so.id}/quote/items`;
      const item = { description: 'Nova', quantity: '1', unitPrice: '10.00', type: 'PART' };

      expect((await call('POST', base, org.technician, item)).statusCode).toBe(403);
      expect((await call('PATCH', `${base}/${itemId}`, org.technician, { unitPrice: '1.00' })).statusCode).toBe(403);
      expect((await call('PATCH', `${base}/${itemId}`, org.technician, { quantity: '9' })).statusCode).toBe(403);
      expect((await call('DELETE', `${base}/${itemId}`, org.technician)).statusCode).toBe(403);
      expect((await call('PATCH', `${base}/${itemId}`, org.technician, { description: 'Troca da fonte', type: 'LABOR' })).statusCode).toBe(200);
      let row = await db.quote.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
      expect(row.total.toString()).toBe('100'); expect(row.items).toHaveLength(1);
      expect(row.items[0]).toMatchObject({ description: 'Troca da fonte', type: 'LABOR' });

      expect((await call('POST', base, org.admin, item)).statusCode).toBe(201);
      expect((await call('PATCH', `${base}/${itemId}`, org.owner, { unitPrice: '50.00' })).statusCode).toBe(200);
      row = await db.quote.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
      expect(row.total.toString()).toBe('60');
    });

    it('keeps technicians from deciding quotes or approving orders, as before', async () => {
      const org = await organization('Decisions'); const so = await order(org, { status: 'WAITING_APPROVAL' }); await quote(so.id, 'PENDING');
      expect((await decideQuote(org.technician, so.id, 'APPROVED')).statusCode).toBe(403);
      expect((await setStatus(org.technician, so.id, 'APPROVED')).statusCode).toBe(403);
      expect(await statusOf(so.id)).toBe('WAITING_APPROVAL');
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of two conflicting status changes win and leaves a coherent history', async () => {
      for (let round = 0; round < 3; round += 1) {
        const org = await organization(`RaceStatus${round}`); const so = await order(org, { status: 'READY' });
        const responses = await Promise.all([setStatus(org.owner, so.id, 'DELIVERED'), setStatus(org.owner, so.id, 'CANCELLED'), setStatus(org.owner, so.id, 'DELIVERED'), setStatus(org.owner, so.id, 'CANCELLED')]);
        expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
        expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(3);
        const winner = responses.find((response) => response.statusCode === 200)!.json().serviceOrder.status;
        expect(await statusOf(so.id)).toBe(winner);
        const entries = await expectCoherentHistory(so.id);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ fromStatus: 'READY', toStatus: winner });
      }
    });

    it('keeps order and quote coherent when a quote approval races with cancelling the order', async () => {
      for (let round = 0; round < 3; round += 1) {
        const org = await organization(`RaceCancel${round}`); const so = await order(org, { status: 'WAITING_APPROVAL' }); await quote(so.id, 'PENDING');
        const [approve, cancel] = await Promise.all([decideQuote(org.owner, so.id, 'APPROVED'), setStatus(org.owner, so.id, 'CANCELLED')]);

        expect(cancel.statusCode).toBe(200);
        expect(await statusOf(so.id)).toBe('CANCELLED');
        const quoteStatus = (await db.quote.findUniqueOrThrow({ where: { serviceOrderId: so.id } })).status;
        const entries = await expectCoherentHistory(so.id);
        if (approve.statusCode === 200) {
          // A aprovacao venceu: a OS passou por APPROVED e so depois foi cancelada.
          expect(quoteStatus).toBe('APPROVED');
          expect(entries.map((entry) => entry.toStatus)).toEqual(['APPROVED', 'CANCELLED']);
        } else {
          // O cancelamento venceu: o orcamento nao pode mais ser decidido.
          expect(approve.statusCode).toBe(409);
          expect(quoteStatus).toBe('PENDING');
          expect(entries.map((entry) => entry.toStatus)).toEqual(['CANCELLED']);
        }
      }
    });

    it('approves the order exactly once when the quote approval races with a direct order approval', async () => {
      for (let round = 0; round < 3; round += 1) {
        const org = await organization(`RaceApprove${round}`); const so = await order(org, { status: 'WAITING_APPROVAL' }); await quote(so.id, 'PENDING');
        const [approveQuote, approveOrder] = await Promise.all([decideQuote(org.owner, so.id, 'APPROVED'), setStatus(org.owner, so.id, 'APPROVED')]);
        expect(approveQuote.statusCode).toBe(200);
        // O pedido direto so passa se o orcamento ja estava aprovado; nesse caso a OS ja foi avancada e ele e invalido.
        expect(approveOrder.statusCode).toBe(409);
        expect(await statusOf(so.id)).toBe('APPROVED');
        expect((await db.quote.findUniqueOrThrow({ where: { serviceOrderId: so.id } })).status).toBe('APPROVED');
        const entries = await expectCoherentHistory(so.id);
        expect(entries.map((entry) => entry.toStatus)).toEqual(['APPROVED']);
      }
    });

    it('never ends with a delivered order that has a pending payment, when delivery races with a new payment', async () => {
      for (let round = 0; round < 3; round += 1) {
        const org = await organization(`RaceDeliver${round}`); const so = await order(org, { status: 'READY', finalValue: '100.00' });
        await payment(org, so.id, 'PAID', '60.00');
        const [deliver, create] = await Promise.all([setStatus(org.owner, so.id, 'DELIVERED'), pay(org.owner, so.id, '40.00')]);
        // 60 de 100 confirmados: a entrega nunca passa, qualquer que seja a ordem.
        expect(deliver.statusCode).toBe(409);
        expect(await statusOf(so.id)).toBe('READY');
        expect([201, 409]).toContain(create.statusCode);
        expect(await db.payment.count({ where: { serviceOrderId: so.id, status: 'PENDING' } })).toBe(create.statusCode === 201 ? 1 : 0);
      }
      for (let round = 0; round < 3; round += 1) {
        const org = await organization(`RaceDeliver2${round}`); const so = await order(org, { status: 'READY', finalValue: '100.00' });
        await payment(org, so.id, 'PAID', '60.00'); const last = await payment(org, so.id, 'PENDING', '40.00');
        const [deliver, confirm] = await Promise.all([setStatus(org.owner, so.id, 'DELIVERED'), payStatus(org.owner, so.id, last.id, 'PAID')]);
        // Entregar so e possivel depois da confirmacao; confirmar nunca e barrado (a entrega nao ocorre com pendente).
        expect(confirm.statusCode).toBe(200);
        expect([200, 409]).toContain(deliver.statusCode);
        expect((await db.payment.findUniqueOrThrow({ where: { id: last.id } })).status).toBe('PAID');
        expect(await statusOf(so.id)).toBe(deliver.statusCode === 200 ? 'DELIVERED' : 'READY');
        expect(await db.payment.count({ where: { serviceOrderId: so.id, status: 'PENDING' } })).toBe(0);
        // Se a entrega perdeu a corrida, um novo pedido (ja sem pendentes e quitado) passa.
        if (deliver.statusCode === 409) expect((await setStatus(org.owner, so.id, 'DELIVERED')).statusCode).toBe(200);
      }
    });

    it('never ends with a cancelled order holding a confirmed payment, when cancelling races with confirming it', async () => {
      for (let round = 0; round < 3; round += 1) {
        const org = await organization(`RaceCancelPay${round}`); const so = await order(org, { status: 'IN_PROGRESS', finalValue: '100.00' });
        const pending = await payment(org, so.id, 'PENDING', '100.00');
        const [cancel, confirm] = await Promise.all([setStatus(org.owner, so.id, 'CANCELLED'), payStatus(org.owner, so.id, pending.id, 'PAID')]);
        const status = await statusOf(so.id);
        const stored = (await db.payment.findUniqueOrThrow({ where: { id: pending.id } })).status;
        expect(status === 'CANCELLED' && stored === 'PAID').toBe(false);
        if (cancel.statusCode === 200) { expect(status).toBe('CANCELLED'); expect(confirm.statusCode).toBe(409); expect(stored).toBe('PENDING'); }
        else { expect(cancel.statusCode).toBe(409); expect(confirm.statusCode).toBe(200); expect(status).toBe('IN_PROGRESS'); expect(stored).toBe('PAID'); }
      }
    });
  });

  describe('multi-tenant isolation', () => {
    it('answers 404 to another organization for every lifecycle operation and changes nothing', async () => {
      const alpha = await organization('IsoA'); const beta = await organization('IsoB');
      const so = await order(alpha, { status: 'WAITING_APPROVAL', finalValue: '100.00' }); const q = await quote(so.id, 'PENDING');
      const pending = await payment(alpha, so.id, 'PENDING', '10.00');
      const before = await db.serviceOrder.findUniqueOrThrow({ where: { id: so.id } });

      const attempts = await Promise.all([
        setStatus(beta.owner, so.id, 'CANCELLED'), setStatus(beta.owner, so.id, 'APPROVED'),
        decideQuote(beta.owner, so.id, 'APPROVED'),
        call('PATCH', `/api/service-orders/${so.id}`, beta.owner, { finalValue: '1.00' }),
        call('POST', `/api/service-orders/${so.id}/quote/items`, beta.owner, { description: 'x', quantity: '1', unitPrice: '1.00', type: 'PART' }),
        payStatus(beta.owner, so.id, pending.id, 'PAID'),
        pay(beta.owner, so.id, '1.00'),
      ]);
      expect(attempts.map((response) => response.statusCode)).toEqual(Array(attempts.length).fill(404));
      for (const response of attempts) expect(response.body).not.toMatch(/delivered|cancelled|approved quote|open balance|refund/i);
      expect(await db.serviceOrder.findUniqueOrThrow({ where: { id: so.id } })).toEqual(before);
      expect((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('PENDING');
      expect(await history(so.id)).toHaveLength(0);
    });
  });
});
