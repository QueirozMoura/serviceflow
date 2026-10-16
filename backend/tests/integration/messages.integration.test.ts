import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas, incluindo a de Message). Nada aqui toca o banco de desenvolvimento.
const temporary: TemporaryDatabase = createTemporaryDatabase('messages');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { PrismaMessageRepository } = await import('../../src/modules/messages/repository.js');
const { makeOrganizationSlug } = await import('../../src/modules/auth/service.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { env } = await import('../../src/config/env.js');

describe('message history against a real PostgreSQL database', () => {
  let db: PrismaClient;
  let auth: InstanceType<typeof PrismaAuthRepository>;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: temporary.url } } });
    auth = new PrismaAuthRepository(db);
    app = buildApp({ authRepository: auth, messageRepository: new PrismaMessageRepository(db) });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    temporary.drop();
  }, 60_000);

  async function session(userId: string, organizationId: string) {
    const { token, tokenHash } = createSessionToken();
    await auth.createSession({ tokenHash, userId, organizationId, expiresAt: sessionExpiresAt() });
    return `${env.AUTH_COOKIE_NAME}=${token}`;
  }
  async function organization(name: string, customerEmail: string | null) {
    const { user } = await auth.createOrganizationWithOwner({ organizationName: `Org ${name}`, slug: makeOrganizationSlug(`Org ${name}`), name: `${name} Owner`, email: `${name.toLowerCase()}-owner@example.com`, passwordHash: await bcrypt.hash('StrongPass1', 4) });
    const organizationId = user.organizationId;
    const customer = await db.customer.create({ data: { organizationId, name: `Cliente ${name}`, phone: `5511-${name}-0001`, email: customerEmail } });
    const equipment = await db.equipment.create({ data: { organizationId, customerId: customer.id, type: 'Notebook', brand: 'Dell', model: name } });
    const serviceOrder = await db.serviceOrder.create({ data: { organizationId, customerId: customer.id, equipmentId: equipment.id, orderNumber: `OS-${name}`, status: 'RECEIVED', problemDescription: 'x', receivedAt: new Date() } });
    const technician = await db.user.create({ data: { organizationId, name: `Tecnico ${name}`, email: `tec-${name.toLowerCase()}@example.com`, role: UserRole.TECHNICIAN } });
    return { organizationId, customer, equipment, serviceOrder, owner: { id: user.id, cookie: await session(user.id, organizationId) }, technician: { id: technician.id, cookie: await session(technician.id, organizationId) } };
  }
  const url = (serviceOrderId: string) => `/api/service-orders/${serviceOrderId}/messages/history`;
  const post = (serviceOrderId: string, cookie: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: url(serviceOrderId), headers: { cookie, ...headers }, payload: payload as object });
  const get = (serviceOrderId: string, cookie?: string, query = '') => app.inject({ method: 'GET', url: url(serviceOrderId) + query, headers: cookie ? { cookie } : {} });
  const draft = { type: 'SERVICE_RECEIVED', channel: 'WHATSAPP' };

  let alpha: Awaited<ReturnType<typeof organization>>; let beta: Awaited<ReturnType<typeof organization>>;
  beforeAll(async () => { alpha = await organization('Alpha', null); beta = await organization('Beta', 'beta-cliente@example.com'); }, 60_000);

  it('persists a DRAFT tied to the organization, order, recipient and author taken from the session and the database', async () => {
    const response = await post(alpha.serviceOrder.id, alpha.technician.cookie, draft);
    expect(response.statusCode).toBe(201);

    const row = await db.message.findUniqueOrThrow({ where: { id: response.json().message.id } });
    expect(row).toMatchObject({ organizationId: alpha.organizationId, serviceOrderId: alpha.serviceOrder.id, customerId: alpha.customer.id, createdByUserId: alpha.technician.id, type: 'SERVICE_RECEIVED', channel: 'WHATSAPP', status: 'DRAFT', idempotencyKey: null });
    expect(row.content).toContain('Cliente Alpha');
    expect(row.content).toContain('OS-Alpha');
    expect(response.json().message).toMatchObject({ status: 'DRAFT', content: row.content, createdBy: { name: 'Tecnico Alpha' }, recipient: { name: 'Cliente Alpha' } });
    expect(response.body).not.toMatch(/5511-Alpha|organizationId|beta/i);
  });

  it('lists the history newest first and only for the order asked for', async () => {
    const second = await post(alpha.serviceOrder.id, alpha.owner.cookie, { type: 'SERVICE_READY', channel: 'WHATSAPP' });
    expect(second.statusCode).toBe(201);
    const list = (await get(alpha.serviceOrder.id, alpha.technician.cookie)).json();

    expect(list.sendingAvailable).toBe(false);
    expect(list.messages.map((message: { type: string }) => message.type)).toEqual(['SERVICE_READY', 'SERVICE_RECEIVED']);
    expect(list.messages.map((message: { createdBy: { name: string } }) => message.createdBy.name)).toEqual(['Alpha Owner', 'Tecnico Alpha']);
    expect((await get(beta.serviceOrder.id, beta.owner.cookie)).json().messages).toEqual([]);
  });

  it('does not let one organization read or write another one\'s order history, and stores nothing when it tries', async () => {
    await post(beta.serviceOrder.id, beta.owner.cookie, draft);
    const before = await db.message.count();

    const foreignRead = await get(beta.serviceOrder.id, alpha.owner.cookie);
    const foreignWrite = await post(beta.serviceOrder.id, alpha.owner.cookie, draft);
    const absentRead = await get('00000000-0000-4000-8000-000000000000', alpha.owner.cookie);
    const forgedQuery = await get(beta.serviceOrder.id, alpha.owner.cookie, `?organizationId=${beta.organizationId}`);
    const forgedBody = await post(beta.serviceOrder.id, alpha.owner.cookie, { ...draft, organizationId: beta.organizationId, customerId: beta.customer.id, createdByUserId: beta.owner.id });

    expect([foreignRead.statusCode, foreignWrite.statusCode, absentRead.statusCode, forgedQuery.statusCode]).toEqual([404, 404, 404, 404]);
    expect(foreignRead.json()).toEqual(absentRead.json());
    expect(forgedBody.statusCode).toBe(400);
    expect(await db.message.count()).toBe(before);
    expect(foreignRead.body).not.toMatch(/Cliente Beta|OS-Beta/);
    // O historico de cada organizacao segue intacto.
    expect((await get(beta.serviceOrder.id, beta.owner.cookie)).json().messages).toHaveLength(1);
    expect(await db.message.count({ where: { organizationId: alpha.organizationId } })).toBe(2);
  });

  it('requires authentication', async () => {
    expect((await get(alpha.serviceOrder.id)).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: url(alpha.serviceOrder.id), payload: draft })).statusCode).toBe(401);
    expect((await get(alpha.serviceOrder.id, `${env.AUTH_COOKIE_NAME}=forged`)).statusCode).toBe(401);
  });

  it('validates the channel against the recipient and the template against the data', async () => {
    const before = await db.message.count();
    expect((await post(alpha.serviceOrder.id, alpha.owner.cookie, { ...draft, channel: 'EMAIL' })).statusCode).toBe(409);
    expect((await post(alpha.serviceOrder.id, alpha.owner.cookie, { ...draft, channel: 'SMS' })).statusCode).toBe(400);
    expect((await post(alpha.serviceOrder.id, alpha.owner.cookie, { type: 'DIAGNOSIS_READY', channel: 'WHATSAPP' })).statusCode).toBe(409);
    expect(await db.message.count()).toBe(before);

    const email = await post(beta.serviceOrder.id, beta.owner.cookie, { ...draft, channel: 'EMAIL' });
    expect(email.statusCode).toBe(201);
    expect(email.json().message.channel).toBe('EMAIL');
    expect(email.body).not.toContain('beta-cliente@example.com');

    await db.diagnosis.create({ data: { serviceOrderId: alpha.serviceOrder.id, description: 'Placa-mae danificada' } });
    const diagnosis = await post(alpha.serviceOrder.id, alpha.owner.cookie, { type: 'DIAGNOSIS_READY', channel: 'WHATSAPP' });
    expect(diagnosis.statusCode).toBe(201);
    expect(diagnosis.json().message.content).toContain('Placa-mae danificada');
  });

  it('records the recipient at the time and keeps it when the order later changes customer', async () => {
    const created = await post(alpha.serviceOrder.id, alpha.owner.cookie, { type: 'SERVICE_IN_PROGRESS', channel: 'WHATSAPP' });
    const messageId = created.json().message.id as string;
    const other = await db.customer.create({ data: { organizationId: alpha.organizationId, name: 'Novo Cliente', phone: '5511-0000' } });
    await db.serviceOrder.update({ where: { id: alpha.serviceOrder.id }, data: { customerId: other.id } });

    const listed = (await get(alpha.serviceOrder.id, alpha.owner.cookie)).json().messages.find((message: { id: string }) => message.id === messageId);
    expect(listed.recipient).toEqual({ name: 'Cliente Alpha' });
    expect((await db.message.findUniqueOrThrow({ where: { id: messageId } })).customerId).toBe(alpha.customer.id);
    await db.serviceOrder.update({ where: { id: alpha.serviceOrder.id }, data: { customerId: alpha.customer.id } });
  });

  it('never exposes payment data through messages, even to roles that cannot read payments', async () => {
    await db.payment.create({ data: { organizationId: beta.organizationId, serviceOrderId: beta.serviceOrder.id, amount: 777.77, status: 'PAID', method: 'PIX' } });
    const quote = await db.quote.create({ data: { serviceOrderId: beta.serviceOrder.id, status: 'PENDING', total: 120 } });
    await db.serviceItem.create({ data: { quoteId: quote.id, description: 'Teclado', quantity: 1, unitPrice: 120, type: 'PART' } });

    const created = await post(beta.serviceOrder.id, beta.technician.cookie, { type: 'QUOTE_READY', channel: 'WHATSAPP' });
    const history = await get(beta.serviceOrder.id, beta.technician.cookie);

    expect(created.statusCode).toBe(201);
    expect(created.json().message.content).toContain('R$ 120,00');
    expect(created.body + history.body).not.toMatch(/777|PAID|pagamento/i);
    expect((await app.inject({ method: 'GET', url: `/api/service-orders/${beta.serviceOrder.id}/payments`, headers: { cookie: beta.technician.cookie } })).statusCode).toBe(403);
  });

  describe('idempotency', () => {
    it('stores one row for a repeated request and for parallel repeats of the same key', async () => {
      const key = 'idem-sequential-1';
      const first = await post(alpha.serviceOrder.id, alpha.owner.cookie, draft, { 'idempotency-key': key });
      const second = await post(alpha.serviceOrder.id, alpha.owner.cookie, draft, { 'idempotency-key': key });
      expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
      expect(second.json().message.id).toBe(first.json().message.id);

      const parallelKey = 'idem-parallel-0001';
      const responses = await Promise.all(Array.from({ length: 8 }, () => post(alpha.serviceOrder.id, alpha.technician.cookie, draft, { 'idempotency-key': parallelKey })));
      expect(new Set(responses.map((response) => response.statusCode))).toEqual(new Set([200, 201]));
      expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
      expect(new Set(responses.map((response) => response.json().message.id)).size).toBe(1);
      expect(await db.message.count({ where: { organizationId: alpha.organizationId, idempotencyKey: { in: [key, parallelKey] } } })).toBe(2);
    });

    it('rejects a key reused with different data and keeps keys separate per organization', async () => {
      const key = 'idem-conflict-0001';
      expect((await post(alpha.serviceOrder.id, alpha.owner.cookie, draft, { 'idempotency-key': key })).statusCode).toBe(201);
      expect((await post(alpha.serviceOrder.id, alpha.owner.cookie, { ...draft, type: 'SERVICE_READY' }, { 'idempotency-key': key })).statusCode).toBe(409);

      const sameKeyOtherOrganization = await post(beta.serviceOrder.id, beta.owner.cookie, draft, { 'idempotency-key': key });
      expect(sameKeyOtherOrganization.statusCode).toBe(201);
      expect(await db.message.count({ where: { idempotencyKey: key } })).toBe(2);
      // Uma chave de outra organizacao nunca devolve o registro dela.
      const crossReplay = await post(alpha.serviceOrder.id, alpha.owner.cookie, draft, { 'idempotency-key': key });
      expect(crossReplay.json().message.recipient).toEqual({ name: 'Cliente Alpha' });
    });
  });

  it('keeps the generate-only route working and does not persist anything', async () => {
    const before = await db.message.count();
    const response = await app.inject({ method: 'POST', url: `/api/service-orders/${alpha.serviceOrder.id}/messages`, headers: { cookie: alpha.technician.cookie }, payload: { type: 'SERVICE_RECEIVED' } });
    expect(response.statusCode).toBe(200);
    expect(await db.message.count()).toBe(before);
  });

  it('protects the history with restrictive foreign keys', async () => {
    await expect(db.serviceOrder.delete({ where: { id: alpha.serviceOrder.id } })).rejects.toThrow();
    expect(await db.serviceOrder.count({ where: { id: alpha.serviceOrder.id } })).toBe(1);
    // A chave composta impede gravar uma mensagem de uma organizacao apontando para a OS de outra.
    await expect(db.message.create({ data: { organizationId: alpha.organizationId, serviceOrderId: beta.serviceOrder.id, customerId: alpha.customer.id, createdByUserId: alpha.owner.id, type: 'SERVICE_RECEIVED', channel: 'WHATSAPP', content: 'x' } })).rejects.toThrow();
    await expect(db.message.create({ data: { organizationId: alpha.organizationId, serviceOrderId: alpha.serviceOrder.id, customerId: alpha.customer.id, createdByUserId: beta.owner.id, type: 'SERVICE_RECEIVED', channel: 'WHATSAPP', content: 'x' } })).rejects.toThrow();
  });

  describe('repository guarantees (independent of the route pre-checks)', () => {
    const repository = () => new PrismaMessageRepository(db);

    it('refuses to record against an order of another organization, even when called directly', async () => {
      const before = await db.message.count();
      const result = await repository().createHistory({ organizationId: alpha.organizationId, createdByUserId: alpha.owner.id, serviceOrderId: beta.serviceOrder.id, type: 'SERVICE_RECEIVED', channel: 'WHATSAPP', content: 'x' });

      expect(result).toBeNull();
      expect(await db.message.count()).toBe(before);
      expect(await repository().listHistory(alpha.organizationId, beta.serviceOrder.id)).toBeNull();
      expect(await repository().findHistoryByKey(alpha.organizationId, 'idem-sequential-1')).not.toBeNull();
      expect(await repository().findHistoryByKey(beta.organizationId, 'idem-sequential-1')).toBeNull();
    });

    it('resolves a unique-key race to a single row: one creator, the others get the existing record', async () => {
      const input = { organizationId: alpha.organizationId, createdByUserId: alpha.owner.id, serviceOrderId: alpha.serviceOrder.id, type: 'SERVICE_DELIVERED' as const, channel: 'WHATSAPP' as const, content: 'Entrega confirmada', idempotencyKey: 'repo-race-key-0001' };
      const results = await Promise.all(Array.from({ length: 6 }, () => repository().createHistory(input)));

      expect(results.every((result) => result !== null)).toBe(true);
      expect(results.filter((result) => result?.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result?.record.id)).size).toBe(1);
      expect(await db.message.count({ where: { idempotencyKey: 'repo-race-key-0001' } })).toBe(1);
    });

    it('does not swallow unrelated database errors as duplicates', async () => {
      await expect(repository().createHistory({ organizationId: alpha.organizationId, createdByUserId: beta.owner.id, serviceOrderId: alpha.serviceOrder.id, type: 'SERVICE_RECEIVED', channel: 'WHATSAPP', content: 'x', idempotencyKey: 'repo-fk-key-00001' })).rejects.toThrow();
      expect(await db.message.count({ where: { idempotencyKey: 'repo-fk-key-00001' } })).toBe(0);
    });
  });
});
