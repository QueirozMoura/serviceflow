import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas). As "requisicoes simultaneas" sao app.inject em
// Promise.all contra o pool real do Prisma: as transacoes realmente competem pelos mesmos registros.
const temporary: TemporaryDatabase = createTemporaryDatabase('financial');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';

const { PrismaServiceOrderRepository } = await import('../../src/modules/service-orders/repository.js');
const { PrismaPaymentRepository } = await import('../../src/modules/payments/repository.js');
const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { makeOrganizationSlug } = await import('../../src/modules/auth/service.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { env } = await import('../../src/config/env.js');

describe('financial integrity against a real PostgreSQL database', () => {
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
  async function organization(name: string) {
    const { user } = await auth.createOrganizationWithOwner({ organizationName: `Org ${name}`, slug: makeOrganizationSlug(`Org ${name}`), name: `${name} Owner`, email: `${name.toLowerCase()}-owner@example.com`, passwordHash: await bcrypt.hash('StrongPass1', 4) });
    const { token, tokenHash } = createSessionToken();
    await auth.createSession({ tokenHash, userId: user.id, organizationId: user.organizationId, expiresAt: sessionExpiresAt() });
    return { organizationId: user.organizationId, cookie: `${env.AUTH_COOKIE_NAME}=${token}` };
  }
  type Org = Awaited<ReturnType<typeof organization>>;

  async function customer(org: Org) { return db.customer.create({ data: { organizationId: org.organizationId, name: 'Cliente', phone: '5511-0000' } }); }
  async function equipment(org: Org, customerId: string) { return db.equipment.create({ data: { organizationId: org.organizationId, customerId, type: 'Notebook' } }); }
  async function serviceOrder(org: Org, finalValue?: string) {
    const c = await customer(org); const e = await equipment(org, c.id);
    return db.serviceOrder.create({ data: { organizationId: org.organizationId, customerId: c.id, equipmentId: e.id, orderNumber: `OS-${++counter}-${org.organizationId.slice(0, 6)}`, status: 'RECEIVED', problemDescription: 'x', receivedAt: new Date(), ...(finalValue ? { finalValue } : {}) } });
  }
  /** Cria o orcamento com um item e, por padrao, o aprova: so orcamento APPROVED vale como valor devido. */
  async function quoteWithTotal(org: Org, serviceOrderId: string, unitPrice: string, approve = true) {
    expect((await call('POST', `/api/service-orders/${serviceOrderId}/quote`, org, {})).statusCode).toBe(201);
    const response = await call('POST', `/api/service-orders/${serviceOrderId}/quote/items`, org, { description: 'Servico', quantity: '1', unitPrice, type: 'LABOR' });
    expect(response.statusCode).toBe(201);
    if (approve) expect((await call('PATCH', `/api/service-orders/${serviceOrderId}/quote/status`, org, { status: 'APPROVED' })).statusCode).toBe(200);
  }
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, org: Org, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { cookie: org.cookie, ...headers }, ...(payload ? { payload } : {}) });
  /** Cria N itens (em sequencia) e devolve seus ids lidos do banco; a API ordena por id, nao por criacao. */
  async function seedItems(org: Org, serviceOrderId: string, count: number, unitPrice: string) {
    for (let index = 0; index < count; index += 1) expect((await call('POST', `/api/service-orders/${serviceOrderId}/quote/items`, org, item(unitPrice))).statusCode).toBe(201);
    const rows = await db.serviceItem.findMany({ where: { quote: { serviceOrderId } }, select: { id: true } });
    expect(rows).toHaveLength(count);
    return rows.map((row) => row.id);
  }
  const item = (unitPrice: string, quantity = '1') => ({ description: `Item ${unitPrice}`, quantity, unitPrice, type: 'PART' });

  /** Compara o total persistido com a soma real dos itens no banco. */
  async function expectTotalMatchesItems(serviceOrderId: string, expectedItems?: number) {
    const quote = await db.quote.findUniqueOrThrow({ where: { serviceOrderId }, include: { items: true } });
    const sum = quote.items.reduce((total, row) => total.add(row.quantity.mul(row.unitPrice)), new Prisma.Decimal(0)).toDecimalPlaces(2);
    expect(quote.total.toString()).toBe(sum.toString());
    if (expectedItems !== undefined) expect(quote.items).toHaveLength(expectedItems);
    return quote;
  }

  describe('quote totals under concurrency', () => {
    it('keeps the total equal to the sum of the items after many simultaneous additions', async () => {
      const org = await organization('QuoteAdd'); const order = await serviceOrder(org);
      expect((await call('POST', `/api/service-orders/${order.id}/quote`, org, {})).statusCode).toBe(201);

      const responses = await Promise.all(Array.from({ length: 25 }, (_, index) => call('POST', `/api/service-orders/${order.id}/quote/items`, org, item(`${index + 1}.10`, '2'))));
      expect(responses.map((response) => response.statusCode)).toEqual(Array(25).fill(201));

      // sum(2 * (i + 0.10)) para i = 1..25 = 2 * (325 + 2.5) = 655
      const quote = await expectTotalMatchesItems(order.id, 25);
      expect(quote.total.toString()).toBe('655');
    });

    it('keeps the total exact for fractional prices and quantities', async () => {
      const org = await organization('QuoteExact'); const order = await serviceOrder(org);
      expect((await call('POST', `/api/service-orders/${order.id}/quote`, org, {})).statusCode).toBe(201);
      await Promise.all(Array.from({ length: 30 }, () => call('POST', `/api/service-orders/${order.id}/quote/items`, org, item('0.10', '1.000'))));
      expect((await expectTotalMatchesItems(order.id, 30)).total.toString()).toBe('3');
    });

    it('applies simultaneous edits of different items without losing any of them', async () => {
      const org = await organization('QuoteEdit'); const order = await serviceOrder(org);
      expect((await call('POST', `/api/service-orders/${order.id}/quote`, org, {})).statusCode).toBe(201);
      const ids = await seedItems(org, order.id, 10, '1.00');

      const responses = await Promise.all(ids.map((id, index) => call('PATCH', `/api/service-orders/${order.id}/quote/items/${id}`, org, { unitPrice: `${(index + 1) * 10}.00` })));
      expect(responses.map((response) => response.statusCode)).toEqual(Array(10).fill(200));
      expect((await expectTotalMatchesItems(order.id, 10)).total.toString()).toBe('550');
    });

    it('stays consistent when additions, edits and removals race on the same quote', async () => {
      const org = await organization('QuoteMixed'); const order = await serviceOrder(org);
      expect((await call('POST', `/api/service-orders/${order.id}/quote`, org, {})).statusCode).toBe(201);
      const ids = await seedItems(org, order.id, 8, '5.00');

      const responses = await Promise.all([
        ...Array.from({ length: 6 }, (_, index) => call('POST', `/api/service-orders/${order.id}/quote/items`, org, item(`${index + 1}.25`, '3'))),
        ...ids.slice(0, 4).map((id) => call('PATCH', `/api/service-orders/${order.id}/quote/items/${id}`, org, { quantity: '2.500' })),
        ...ids.slice(4).map((id) => call('DELETE', `/api/service-orders/${order.id}/quote/items/${id}`, org)),
      ]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([...Array(6).fill(201), ...Array(8).fill(200)].sort());
      await expectTotalMatchesItems(order.id, 8 + 6 - 4);
    });

    it('answers 404 for a repeated removal of the same item and keeps the total right', async () => {
      const org = await organization('QuoteDouble'); const order = await serviceOrder(org);
      await call('POST', `/api/service-orders/${order.id}/quote`, org, {});
      const created = await call('POST', `/api/service-orders/${order.id}/quote/items`, org, item('9.99'));
      await call('POST', `/api/service-orders/${order.id}/quote/items`, org, item('1.00'));
      const itemId = created.json().quote.items[0].id;

      const responses = await Promise.all([1, 2, 3].map(() => call('DELETE', `/api/service-orders/${order.id}/quote/items/${itemId}`, org)));
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 404, 404]);
      expect((await expectTotalMatchesItems(order.id, 1)).total.toString()).toBe('1');
    });

    it('does not let another organization touch the items or the total', async () => {
      const alpha = await organization('QuoteIsoA'); const beta = await organization('QuoteIsoB'); const order = await serviceOrder(alpha);
      await call('POST', `/api/service-orders/${order.id}/quote`, alpha, {});
      const created = await call('POST', `/api/service-orders/${order.id}/quote/items`, alpha, item('10.00'));
      const itemId = created.json().quote.items[0].id;

      const attempts = await Promise.all([
        call('POST', `/api/service-orders/${order.id}/quote/items`, beta, item('99.00')),
        call('PATCH', `/api/service-orders/${order.id}/quote/items/${itemId}`, beta, { unitPrice: '99.00' }),
        call('DELETE', `/api/service-orders/${order.id}/quote/items/${itemId}`, beta),
      ]);
      expect(attempts.map((response) => response.statusCode)).toEqual([404, 404, 404]);
      expect((await expectTotalMatchesItems(order.id, 1)).total.toString()).toBe('10');
    });
  });

  describe('payments', () => {
    // Cada chamada e uma operacao distinta (chave nova), a menos que o teste informe a chave para simular repeticao.
    const pay = (org: Org, serviceOrderId: string, amount: string, headers: Record<string, string> = {}, method = 'PIX') => call('POST', `/api/service-orders/${serviceOrderId}/payments`, org, { amount, method }, { 'idempotency-key': randomUUID(), ...headers });
    const payWithoutKey = (org: Org, serviceOrderId: string, amount: string) => call('POST', `/api/service-orders/${serviceOrderId}/payments`, org, { amount, method: 'PIX' });
    const setStatus = (org: Org, serviceOrderId: string, paymentId: string, status: string) => call('PATCH', `/api/service-orders/${serviceOrderId}/payments/${paymentId}/status`, org, { status });
    /** Soma que ocupa saldo, lida direto do banco. */
    const reserved = async (serviceOrderId: string) => (await db.payment.aggregate({ where: { serviceOrderId, status: { in: ['PENDING', 'PAID'] } }, _sum: { amount: true } }))._sum.amount?.toString() ?? '0';
    const countPayments = (serviceOrderId: string) => db.payment.count({ where: { serviceOrderId } });

    describe('idempotency', () => {
      it('records a single payment when the same operation is sent many times at once', async () => {
        const org = await organization('IdemSame'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const responses = await Promise.all(Array.from({ length: 12 }, () => pay(org, order.id, '50.00', { 'idempotency-key': 'op-same-0001' })));

        expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
        expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(11);
        expect(new Set(responses.map((response) => response.json().payment.id)).size).toBe(1);
        expect(await countPayments(order.id)).toBe(1);
      });

      it('rejects creation without a valid Idempotency-Key and writes nothing', async () => {
        const org = await organization('IdemMissing'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const missing = await payWithoutKey(org, order.id, '10.00');
        expect(missing.statusCode).toBe(400);
        expect(missing.json().message).toMatch(/Idempotency-Key/);
        for (const key of ['', 'short', 'has spaces in it!!', 'x'.repeat(81)]) expect((await pay(org, order.id, '10.00', { 'idempotency-key': key })).statusCode).toBe(400);
        expect(await countPayments(order.id)).toBe(0);
      });

      it('allows different legitimate payments with distinct keys, even with the same amount, method and time', async () => {
        const org = await organization('IdemDiff'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const responses = await Promise.all([1, 2, 3, 4].map((index) => pay(org, order.id, '10.00', { 'idempotency-key': `op-diff-000${index}` })));
        expect(responses.map((response) => response.statusCode)).toEqual([201, 201, 201, 201]);
        expect(new Set(responses.map((response) => response.json().payment.id)).size).toBe(4);
        expect(await countPayments(order.id)).toBe(4);
        expect(await reserved(order.id)).toBe('40');
      });

      it('persists a single payment when one key is sent at once with different contents', async () => {
        const org = await organization('IdemMixed'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const responses = await Promise.all(['10.00', '20.00', '30.00', '10.00', '20.00', '30.00'].map((amount) => pay(org, order.id, amount, { 'idempotency-key': 'op-mixed-0001' })));
        expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
        expect(responses.every((response) => [200, 201, 409].includes(response.statusCode))).toBe(true);
        const rows = await db.payment.findMany({ where: { serviceOrderId: order.id } });
        expect(rows).toHaveLength(1);
        // Quem repetiu o conteudo vencedor recebeu o original; quem trouxe outro conteudo recebeu conflito.
        for (const response of responses.filter((r) => r.statusCode !== 409)) expect(response.json().payment.id).toBe(rows[0]!.id);
        for (const response of responses.filter((r) => r.statusCode === 409)) expect(response.json().payment).toBeUndefined();
      });

      it('rejects a key reused with different data, on another order, and validates its format', async () => {
        const org = await organization('IdemReuse'); const order = await serviceOrder(org); const other = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00'); await quoteWithTotal(org, other.id, '100.00');
        expect((await pay(org, order.id, '10.00', { 'idempotency-key': 'op-reuse-0001' })).statusCode).toBe(201);

        for (const [id, amount, method] of [[order.id, '11.00', 'PIX'], [order.id, '10.00', 'CASH'], [other.id, '10.00', 'PIX']]) {
          const response = await pay(org, id as string, amount as string, { 'idempotency-key': 'op-reuse-0001' }, method as string);
          expect(response.statusCode).toBe(409);
          expect(response.body).not.toMatch(/prisma|organizationId/i);
        }
        expect(await countPayments(order.id)).toBe(1);
        expect(await countPayments(other.id)).toBe(0);
        expect((await pay(org, order.id, '10.00', { 'idempotency-key': 'curto' })).statusCode).toBe(400);
      });

      it('resolves the same key sent at once for two different orders without duplicating or crashing', async () => {
        const org = await organization('IdemRace'); const first = await serviceOrder(org); const second = await serviceOrder(org);
        await quoteWithTotal(org, first.id, '100.00'); await quoteWithTotal(org, second.id, '100.00');
        const responses = await Promise.all([pay(org, first.id, '10.00', { 'idempotency-key': 'op-race-0001' }), pay(org, second.id, '10.00', { 'idempotency-key': 'op-race-0001' })]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
        expect(await db.payment.count({ where: { idempotencyKey: 'op-race-0001' } })).toBe(1);
      });

      it('scopes keys by organization: the same key in another organization is an independent operation', async () => {
        const alpha = await organization('IdemIsoA'); const beta = await organization('IdemIsoB');
        const alphaOrder = await serviceOrder(alpha); const betaOrder = await serviceOrder(beta);
        await quoteWithTotal(alpha, alphaOrder.id, '100.00'); await quoteWithTotal(beta, betaOrder.id, '100.00');
        const key = { 'idempotency-key': 'op-shared-0001' };
        expect((await pay(alpha, alphaOrder.id, '10.00', key)).statusCode).toBe(201);
        expect((await pay(beta, betaOrder.id, '10.00', key)).statusCode).toBe(201);
        // E nunca devolve (nem toca) o pagamento de outra organizacao.
        const crossOrg = await pay(beta, alphaOrder.id, '10.00', key);
        expect(crossOrg.statusCode).toBe(404);
        expect(await countPayments(alphaOrder.id)).toBe(1);
      });
    });

    describe('balance', () => {
      it('accepts exact and partial payments up to the quote total and rejects anything above it', async () => {
        const org = await organization('BalQuote'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');

        expect((await pay(org, order.id, '40.00')).statusCode).toBe(201);
        const over = await pay(org, order.id, '60.01');
        expect(over.statusCode).toBe(409);
        expect(over.json().message).toBe('Payment amount exceeds the outstanding balance');
        expect((await pay(org, order.id, '60.00')).statusCode).toBe(201);
        // saldo zerado
        expect((await pay(org, order.id, '0.01')).statusCode).toBe(409);
        expect(await countPayments(order.id)).toBe(2);
      });

      it('prefers the service order final value over the quote total when both exist', async () => {
        const org = await organization('BalFinal'); const order = await serviceOrder(org, '80.00');
        await quoteWithTotal(org, order.id, '100.00');
        expect((await pay(org, order.id, '80.01')).statusCode).toBe(409);
        expect((await pay(org, order.id, '80.00')).statusCode).toBe(201);
      });

      it('rejects payments, persisting nothing, whenever the amount due cannot be determined', async () => {
        const org = await organization('BalNone');
        const bare = await serviceOrder(org);
        const estimatedOnly = await serviceOrder(org);
        await db.serviceOrder.update({ where: { id: estimatedOnly.id }, data: { estimatedValue: '500.00' } });
        const emptyQuote = await serviceOrder(org); await call('POST', `/api/service-orders/${emptyQuote.id}/quote`, org, {});
        const zeroFinal = await serviceOrder(org, '0.00');
        const pendingQuote = await serviceOrder(org); await quoteWithTotal(org, pendingQuote.id, '100.00', false);
        const rejected = await serviceOrder(org); await quoteWithTotal(org, rejected.id, '100.00'); await db.quote.update({ where: { serviceOrderId: rejected.id }, data: { status: 'REJECTED' } });
        const expired = await serviceOrder(org); await quoteWithTotal(org, expired.id, '100.00'); await db.quote.update({ where: { serviceOrderId: expired.id }, data: { status: 'EXPIRED' } });

        for (const order of [bare, estimatedOnly, emptyQuote, zeroFinal, pendingQuote, rejected, expired]) {
          const response = await pay(org, order.id, '1.00');
          expect(response.statusCode).toBe(409);
          expect(response.json().message).toMatch(/amount due is not defined/);
          expect(await countPayments(order.id)).toBe(0);
        }
      });

      it('uses the final value, else an APPROVED quote total; a PENDING quote never counts', async () => {
        const org = await organization('BalQuoteStates');
        const pending = await serviceOrder(org); await quoteWithTotal(org, pending.id, '100.00', false);
        const approved = await serviceOrder(org); await quoteWithTotal(org, approved.id, '100.00');
        const finalOverApproved = await serviceOrder(org, '70.00'); await quoteWithTotal(org, finalOverApproved.id, '100.00');
        const finalOverRejected = await serviceOrder(org, '70.00'); await quoteWithTotal(org, finalOverRejected.id, '100.00'); await db.quote.update({ where: { serviceOrderId: finalOverRejected.id }, data: { status: 'REJECTED' } });

        expect((await pay(org, pending.id, '1.00')).statusCode).toBe(409);
        expect(await countPayments(pending.id)).toBe(0);
        expect((await pay(org, approved.id, '100.01')).statusCode).toBe(409);
        expect((await pay(org, approved.id, '100.00')).statusCode).toBe(201);
        for (const order of [finalOverApproved, finalOverRejected]) {
          expect((await pay(org, order.id, '70.01')).statusCode).toBe(409);
          expect((await pay(org, order.id, '70.00')).statusCode).toBe(201);
        }
      });

      it('rejects invalid amounts and amounts that would overflow the column', async () => {
        const org = await organization('BalInvalid'); const order = await serviceOrder(org, '100.00');
        for (const amount of ['0', '0.00', '-1', 'abc', '1.234', '12345678901.00']) expect((await pay(org, order.id, amount)).statusCode).toBe(400);
        expect(await countPayments(order.id)).toBe(0);
      });

      it('lets failed, cancelled and refunded payments free their balance but keeps pending and paid ones counted', async () => {
        const org = await organization('BalStates'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const first = (await pay(org, order.id, '100.00')).json().payment;
        expect((await pay(org, order.id, '1.00')).statusCode).toBe(409);

        expect((await call('PATCH', `/api/service-orders/${order.id}/payments/${first.id}/status`, org, { status: 'PAID' })).statusCode).toBe(200);
        expect((await pay(org, order.id, '1.00')).statusCode).toBe(409);

        expect((await call('PATCH', `/api/service-orders/${order.id}/payments/${first.id}/status`, org, { status: 'REFUNDED' })).statusCode).toBe(200);
        const second = await pay(org, order.id, '100.00');
        expect(second.statusCode).toBe(201);
        expect((await call('PATCH', `/api/service-orders/${order.id}/payments/${second.json().payment.id}/status`, org, { status: 'CANCELLED' })).statusCode).toBe(200);
        expect((await pay(org, order.id, '100.00')).statusCode).toBe(201);
      });

      it('validates an amount edit against the balance, excluding the payment being edited', async () => {
        const org = await organization('BalEdit'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        await pay(org, order.id, '30.00');
        const second = (await pay(org, order.id, '30.00')).json().payment;

        expect((await call('PATCH', `/api/service-orders/${order.id}/payments/${second.id}`, org, { amount: '70.00' })).statusCode).toBe(200);
        const tooMuch = await call('PATCH', `/api/service-orders/${order.id}/payments/${second.id}`, org, { amount: '70.01' });
        expect(tooMuch.statusCode).toBe(409);
        expect((await db.payment.findUniqueOrThrow({ where: { id: second.id } })).amount.toString()).toBe('70');
        // Mudar so o metodo nunca e barrado pelo saldo.
        expect((await call('PATCH', `/api/service-orders/${order.id}/payments/${second.id}`, org, { method: 'CASH' })).statusCode).toBe(200);
      });

      it('never lets simultaneous valid payments add up past the balance', async () => {
        const org = await organization('BalRace'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');

        const responses = await Promise.all(Array.from({ length: 8 }, () => pay(org, order.id, '30.00')));
        const statuses = responses.map((response) => response.statusCode);
        expect(statuses.filter((status) => status === 201)).toHaveLength(3);
        expect(statuses.filter((status) => status === 409)).toHaveLength(5);
        const total = await db.payment.aggregate({ where: { serviceOrderId: order.id }, _sum: { amount: true } });
        expect(total._sum.amount?.toString()).toBe('90');
      });

      it('lets exactly one of two simultaneous payments that each take the whole balance win', async () => {
        const org = await organization('BalRace2'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const responses = await Promise.all([pay(org, order.id, '100.00'), pay(org, order.id, '100.00')]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
      });

      it('keeps legacy payments untouched and does not recalculate history', async () => {
        const org = await organization('BalLegacy'); const order = await serviceOrder(org);
        await db.payment.create({ data: { organizationId: org.organizationId, serviceOrderId: order.id, amount: '500.00', status: 'PAID', method: 'CASH' } });
        await quoteWithTotal(org, order.id, '100.00');
        // Historico acima do devido permanece como esta; so novos pagamentos sao barrados.
        expect((await pay(org, order.id, '1.00')).statusCode).toBe(409);
        expect((await db.payment.findFirstOrThrow({ where: { serviceOrderId: order.id } })).amount.toString()).toBe('500');
      });
    });

    describe('status transitions and reserved balance', () => {
      it('reserves balance while pending and releases it after FAILED or CANCELLED', async () => {
        const org = await organization('TransRelease'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const first = (await pay(org, order.id, '100.00')).json().payment;
        expect((await pay(org, order.id, '0.01')).statusCode).toBe(409);
        expect(await reserved(order.id)).toBe('100');

        expect((await setStatus(org, order.id, first.id, 'FAILED')).statusCode).toBe(200);
        expect(await reserved(order.id)).toBe('0');
        const second = (await pay(org, order.id, '100.00')).json().payment;
        expect((await setStatus(org, order.id, second.id, 'CANCELLED')).statusCode).toBe(200);
        expect((await pay(org, order.id, '60.00')).statusCode).toBe(201);
        expect(await reserved(order.id)).toBe('60');
      });

      it('does not count a payment twice when it goes from PENDING to PAID, and rejects repeating the transition', async () => {
        const org = await organization('TransPaid'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const first = (await pay(org, order.id, '60.00')).json().payment;
        expect((await setStatus(org, order.id, first.id, 'PAID')).statusCode).toBe(200);
        expect(await reserved(order.id)).toBe('60');
        expect((await setStatus(org, order.id, first.id, 'PAID')).statusCode).toBe(409);
        expect((await pay(org, order.id, '40.00')).statusCode).toBe(201);
        expect((await pay(org, order.id, '0.01')).statusCode).toBe(409);
      });

      it('lets only one of several simultaneous conflicting transitions win and keeps the persisted state coherent', async () => {
        const org = await organization('TransRace'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const payment = (await pay(org, order.id, '100.00')).json().payment;

        const responses = await Promise.all([setStatus(org, order.id, payment.id, 'PAID'), setStatus(org, order.id, payment.id, 'CANCELLED'), setStatus(org, order.id, payment.id, 'FAILED'), setStatus(org, order.id, payment.id, 'PAID')]);
        expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
        expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(3);
        const winner = responses.find((response) => response.statusCode === 200)!.json().payment.status;
        const persisted = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(persisted.status).toBe(winner);
        // O saldo so fica livre se a transicao vencedora o liberou; um PAID nunca e liberado por um CANCELLED perdedor.
        expect(await reserved(order.id)).toBe(winner === 'PAID' ? '100' : '0');
      });

      it('never exceeds the balance when creations race with releasing and confirming transitions', async () => {
        const org = await organization('TransMix'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const held = (await pay(org, order.id, '50.00')).json().payment;
        const other = (await pay(org, order.id, '50.00')).json().payment;

        const responses = await Promise.all([
          setStatus(org, order.id, held.id, 'CANCELLED'),
          setStatus(org, order.id, other.id, 'PAID'),
          ...Array.from({ length: 6 }, () => pay(org, order.id, '30.00')),
        ]);
        expect(responses.slice(0, 2).map((response) => response.statusCode)).toEqual([200, 200]);
        const reservedTotal = new Prisma.Decimal(await reserved(order.id));
        expect(reservedTotal.lte(100)).toBe(true);
        // 50 ja pago + no maximo 50 liberados pelo cancelamento: cabe no maximo um de 30, e so se a liberacao veio antes.
        const created = responses.slice(2).filter((response) => response.statusCode === 201).length;
        expect(created).toBeLessThanOrEqual(1);
        expect(responses.slice(2).every((response) => [201, 409].includes(response.statusCode))).toBe(true);
        expect(reservedTotal.toString()).toBe(String(50 + 30 * created));
      });

      it('applies edits and deletions under the same lock, so a payment confirmed meanwhile stays immutable', async () => {
        const org = await organization('TransLock'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const payment = (await pay(org, order.id, '40.00')).json().payment;
        const responses = await Promise.all([setStatus(org, order.id, payment.id, 'PAID'), call('DELETE', `/api/service-orders/${order.id}/payments/${payment.id}`, org), call('PATCH', `/api/service-orders/${order.id}/payments/${payment.id}`, org, { amount: '90.00' })]);
        const row = await db.payment.findUnique({ where: { id: payment.id } });
        if (row === null) {
          // O DELETE ganhou a corrida: as demais encontram a OS sem o pagamento.
          expect(responses[1]!.statusCode).toBe(204);
        } else if (row.status === 'PAID') {
          expect(responses[0]!.statusCode).toBe(200);
          expect(row.amount.toString()).toBe('40');
        }
        expect(Number(await reserved(order.id))).toBeLessThanOrEqual(100);
      });

      it('does not let another organization change or release a payment, and leaks nothing', async () => {
        const alpha = await organization('TransIsoA'); const beta = await organization('TransIsoB');
        const order = await serviceOrder(alpha); await quoteWithTotal(alpha, order.id, '100.00');
        const payment = (await pay(alpha, order.id, '100.00')).json().payment;

        const attempts = await Promise.all([setStatus(beta, order.id, payment.id, 'CANCELLED'), call('PATCH', `/api/service-orders/${order.id}/payments/${payment.id}`, beta, { amount: '1.00' }), call('DELETE', `/api/service-orders/${order.id}/payments/${payment.id}`, beta), call('GET', `/api/service-orders/${order.id}/payments/${payment.id}`, beta)]);
        expect(attempts.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);
        for (const response of attempts) expect(response.body).not.toMatch(/100|PENDING|PIX/);
        expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
        expect((await pay(alpha, order.id, '0.01')).statusCode).toBe(409);
      });

      it('leaves no partial writes when a creation or a transition fails inside its transaction', async () => {
        const org = await organization('TransAtomic'); const order = await serviceOrder(org);
        await quoteWithTotal(org, order.id, '100.00');
        const payment = (await pay(org, order.id, '100.00')).json().payment;

        // Mesma logica de producao, mas com uma escrita que falha no meio da transacao.
        const failing = (method: 'create' | 'updateMany' | 'deleteMany') => new PrismaPaymentRepository(new Proxy(db, {
          get: (target, property) => property !== '$transaction' ? Reflect.get(target, property) : (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction((client) => callback(new Proxy(client, {
            get: (inner, name) => name !== 'payment' ? Reflect.get(inner, name) : new Proxy(inner.payment, { get: (delegate, operation) => operation === method ? () => { throw new Error('simulated failure'); } : (Reflect.get(delegate, operation) as (...args: unknown[]) => unknown).bind(delegate) }),
          }))),
        }) as PrismaClient);

        await expect(failing('updateMany').updateStatus(org.organizationId, order.id, payment.id, 'CANCELLED')).rejects.toThrow('simulated failure');
        expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
        expect(await reserved(order.id)).toBe('100');
        // A liberacao nao foi contabilizada: o saldo continua ocupado.
        expect((await pay(org, order.id, '0.01')).statusCode).toBe(409);

        await expect(failing('deleteMany').delete(org.organizationId, order.id, payment.id)).rejects.toThrow('simulated failure');
        expect(await countPayments(order.id)).toBe(1);

        await db.payment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
        await expect(failing('create').create(org.organizationId, order.id, { amount: '10.00', method: 'PIX' }, 'op-atomic-0001')).rejects.toThrow('simulated failure');
        expect(await db.payment.count({ where: { idempotencyKey: 'op-atomic-0001' } })).toBe(0);
        // E o mesmo conteudo, depois, ainda pode ser registrado normalmente.
        expect((await pay(org, order.id, '10.00', { 'idempotency-key': 'op-atomic-0001' })).statusCode).toBe(201);
      });
    });
  });

  describe('changes to the amount due', () => {
    const pay = (org: Org, serviceOrderId: string, amount: string) => call('POST', `/api/service-orders/${serviceOrderId}/payments`, org, { amount, method: 'PIX' }, { 'idempotency-key': randomUUID() });
    const setFinal = (org: Org, serviceOrderId: string, finalValue: string | null) => call('PATCH', `/api/service-orders/${serviceOrderId}`, org, { finalValue });
    const decide = (org: Org, serviceOrderId: string, status: string) => call('PATCH', `/api/service-orders/${serviceOrderId}/quote/status`, org, { status });
    const reservedSum = async (serviceOrderId: string) => (await db.payment.aggregate({ where: { serviceOrderId, status: { in: ['PENDING', 'PAID'] } }, _sum: { amount: true } }))._sum.amount ?? new Prisma.Decimal(0);
    const dueRow = async (serviceOrderId: string) => db.serviceOrder.findUniqueOrThrow({ where: { id: serviceOrderId }, include: { quote: { include: { items: true } } } });

    it('allows lowering the final value while the reserved payments still fit, and refuses going below them', async () => {
      const org = await organization('DueFinal'); const order = await serviceOrder(org, '100.00');
      await pay(org, order.id, '40.00');

      expect((await setFinal(org, order.id, '40.00')).statusCode).toBe(200);
      const refused = await setFinal(org, order.id, '39.99');
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toBe('The change would leave active payments above the amount due');
      expect((await dueRow(order.id)).finalValue?.toString()).toBe('40');
      // Aumentar, e mudar campos que nao tocam o valor, continuam livres.
      expect((await setFinal(org, order.id, '200.00')).statusCode).toBe(200);
      expect((await call('PATCH', `/api/service-orders/${order.id}`, org, { technicianNotes: 'ok' })).statusCode).toBe(200);
    });

    it('frees the limit once payments are released, and counts PENDING and PAID alike', async () => {
      const org = await organization('DueRelease'); const order = await serviceOrder(org, '100.00');
      const first = (await pay(org, order.id, '60.00')).json().payment;
      const second = (await pay(org, order.id, '30.00')).json().payment;
      await call('PATCH', `/api/service-orders/${order.id}/payments/${second.id}/status`, org, { status: 'PAID' });
      expect((await setFinal(org, order.id, '89.00')).statusCode).toBe(409);
      await call('PATCH', `/api/service-orders/${order.id}/payments/${first.id}/status`, org, { status: 'CANCELLED' });
      expect((await setFinal(org, order.id, '30.00')).statusCode).toBe(200);
      expect((await setFinal(org, order.id, '29.99')).statusCode).toBe(409);
      // Nenhum pagamento foi alterado ou apagado automaticamente.
      expect((await db.payment.findMany({ where: { serviceOrderId: order.id }, orderBy: { amount: 'asc' } })).map((row) => `${row.amount}:${row.status}`)).toEqual(['30:PAID', '60:CANCELLED']);
    });

    it('refuses to remove the final value when that would leave the amount due undetermined or lower, but allows it without reserved payments', async () => {
      const org = await organization('DueRemove');
      const free = await serviceOrder(org, '100.00');
      expect((await setFinal(org, free.id, null)).statusCode).toBe(200);

      const noQuote = await serviceOrder(org, '100.00'); await pay(org, noQuote.id, '10.00');
      expect((await setFinal(org, noQuote.id, null)).statusCode).toBe(409);
      expect((await setFinal(org, noQuote.id, '0.00')).statusCode).toBe(409);

      const withApproved = await serviceOrder(org, '100.00'); await quoteWithTotal(org, withApproved.id, '50.00'); await pay(org, withApproved.id, '60.00');
      // Sem valor final, o devido cai para o orcamento aprovado (50) e os 60 reservados estourariam.
      expect((await setFinal(org, withApproved.id, null)).statusCode).toBe(409);
      expect((await dueRow(withApproved.id)).finalValue?.toString()).toBe('100');
    });

    it('guards quote item changes that lower the total of the approved quote being used as the amount due', async () => {
      const org = await organization('DueItems'); const order = await serviceOrder(org);
      await call('POST', `/api/service-orders/${order.id}/quote`, org, {});
      const item = (await call('POST', `/api/service-orders/${order.id}/quote/items`, org, { description: 'A', quantity: '1', unitPrice: '100.00', type: 'LABOR' })).json().quote.items[0];
      await decide(org, order.id, 'APPROVED');
      await pay(org, order.id, '70.00');

      const itemUrl = `/api/service-orders/${order.id}/quote/items/${item.id}`;
      expect((await call('PATCH', itemUrl, org, { unitPrice: '69.99' })).statusCode).toBe(409);
      expect((await call('DELETE', itemUrl, org)).statusCode).toBe(409);
      expect((await call('PATCH', itemUrl, org, { quantity: '0.500' })).statusCode).toBe(409);
      expect((await dueRow(order.id)).quote?.total.toString()).toBe('100');
      expect((await dueRow(order.id)).quote?.items).toHaveLength(1);

      expect((await call('PATCH', itemUrl, org, { unitPrice: '70.00' })).statusCode).toBe(200);
      expect((await call('POST', `/api/service-orders/${order.id}/quote/items`, org, { description: 'B', quantity: '1', unitPrice: '5.00', type: 'PART' })).statusCode).toBe(201);
      expect((await dueRow(order.id)).quote?.total.toString()).toBe('75');
    });

    it('does not restrict quote edits that do not feed the amount due (pending quote, or a final value in force)', async () => {
      const org = await organization('DueIrrelevant');
      const pending = await serviceOrder(org, '100.00'); await quoteWithTotal(org, pending.id, '100.00', false); await pay(org, pending.id, '90.00');
      const item = (await dueRow(pending.id)).quote!.items[0]!;
      expect((await call('DELETE', `/api/service-orders/${pending.id}/quote/items/${item.id}`, org)).statusCode).toBe(200);
    });

    it('applies the same protection to quote decisions and makes a decision final even when raced', async () => {
      const org = await organization('DueDecision'); const order = await serviceOrder(org);
      await quoteWithTotal(org, order.id, '100.00', false);
      const responses = await Promise.all([decide(org, order.id, 'APPROVED'), decide(org, order.id, 'REJECTED'), decide(org, order.id, 'EXPIRED'), decide(org, order.id, 'APPROVED')]);
      expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
      expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(3);
      const winner = responses.find((response) => response.statusCode === 200)!.json().quote.status;
      expect((await dueRow(order.id)).quote?.status).toBe(winner);

      // Um orcamento decidido nunca volta atras: um APPROVED com pagamentos nao pode virar REJECTED/EXPIRED.
      const approved = await serviceOrder(org); await quoteWithTotal(org, approved.id, '100.00'); await pay(org, approved.id, '50.00');
      expect((await decide(org, approved.id, 'REJECTED')).statusCode).toBe(409);
      expect((await decide(org, approved.id, 'EXPIRED')).statusCode).toBe(409);
      expect((await dueRow(approved.id)).quote?.status).toBe('APPROVED');
      expect((await pay(org, approved.id, '50.01')).statusCode).toBe(409);
    });

    it('never ends with more reserved than due when payments race with a reduction of the final value', async () => {
      for (let round = 0; round < 3; round += 1) {
        const org = await organization(`DueRace${round}`); const order = await serviceOrder(org, '100.00');
        const responses = await Promise.all([setFinal(org, order.id, '40.00'), ...Array.from({ length: 6 }, () => pay(org, order.id, '30.00'))]);
        const row = await dueRow(order.id);
        const reserved = await reservedSum(order.id);
        // Invariante final, lido do banco: o que esta reservado cabe no valor devido vigente.
        expect(reserved.lte(row.finalValue!)).toBe(true);
        const created = responses.slice(1).filter((response) => response.statusCode === 201).length;
        expect(reserved.toString()).toBe(String(30 * created));
        expect(responses.slice(1).every((response) => [201, 409].includes(response.statusCode))).toBe(true);
        expect([200, 409]).toContain(responses[0]!.statusCode);
        // A reducao so vence se ainda coube; senao o valor original permanece.
        expect(row.finalValue!.toString()).toBe(responses[0]!.statusCode === 200 ? '40' : '100');
      }
    });

    it('never ends with more reserved than due when payments race with item removals on the approved quote', async () => {
      for (let round = 0; round < 3; round += 1) {
        const org = await organization(`DueItemRace${round}`); const order = await serviceOrder(org);
        await call('POST', `/api/service-orders/${order.id}/quote`, org, {});
        for (const price of ['50.00', '50.00']) await call('POST', `/api/service-orders/${order.id}/quote/items`, org, { description: 'I', quantity: '1', unitPrice: price, type: 'PART' });
        await decide(org, order.id, 'APPROVED');
        const items = (await dueRow(order.id)).quote!.items;

        await Promise.all([call('DELETE', `/api/service-orders/${order.id}/quote/items/${items[0]!.id}`, org), ...Array.from({ length: 4 }, () => pay(org, order.id, '50.00'))]);
        const row = await dueRow(order.id);
        expect((await reservedSum(order.id)).lte(row.quote!.total)).toBe(true);
        expect(row.quote!.total.toString()).toBe(String(row.quote!.items.length * 50));
      }
    });

    it('leaves no partial writes when the guard refuses or the transaction fails', async () => {
      const org = await organization('DueAtomic'); const order = await serviceOrder(org);
      await call('POST', `/api/service-orders/${order.id}/quote`, org, {});
      const item = (await call('POST', `/api/service-orders/${order.id}/quote/items`, org, { description: 'A', quantity: '1', unitPrice: '100.00', type: 'LABOR' })).json().quote.items[0];
      await decide(org, order.id, 'APPROVED'); await pay(org, order.id, '100.00');

      // Recusa pela guarda: o item e o total voltam ao estado anterior (a escrita feita dentro da transacao e desfeita).
      expect((await call('PATCH', `/api/service-orders/${order.id}/quote/items/${item.id}`, org, { unitPrice: '1.00' })).statusCode).toBe(409);
      const after = await dueRow(order.id);
      expect(after.quote?.items[0]?.unitPrice.toString()).toBe('100');
      expect(after.quote?.total.toString()).toBe('100');

      // Falha inesperada no meio da transacao do repositorio de OS: finalValue nao muda.
      const failing = new PrismaServiceOrderRepository(new Proxy(db, {
        get: (target, property) => property !== '$transaction' ? Reflect.get(target, property) : (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction((client) => callback(new Proxy(client, {
          get: (inner, name) => name !== 'serviceOrder' ? Reflect.get(inner, name) : new Proxy(inner.serviceOrder, { get: (delegate, operation) => operation === 'updateMany' ? () => { throw new Error('simulated failure'); } : (Reflect.get(delegate, operation) as (...args: unknown[]) => unknown).bind(delegate) }),
        }))),
      }) as PrismaClient);
      await expect(failing.update(org.organizationId, order.id, { finalValue: '500.00' }, { canEditValues: true })).rejects.toThrow('simulated failure');
      expect((await dueRow(order.id)).finalValue).toBeNull();
    });

    it('does not let another organization change the amount due, and leaks nothing', async () => {
      const alpha = await organization('DueIsoA'); const beta = await organization('DueIsoB');
      const order = await serviceOrder(alpha, '100.00'); await pay(alpha, order.id, '100.00');
      const attempts = await Promise.all([setFinal(beta, order.id, '1.00'), decide(beta, order.id, 'REJECTED')]);
      expect(attempts.map((response) => response.statusCode)).toEqual([404, 404]);
      for (const response of attempts) expect(response.body).not.toMatch(/100|payment|amount due/i);
      expect((await dueRow(order.id)).finalValue?.toString()).toBe('100');
    });
  });

  describe('deletions with dependants', () => {
    it('deletes a customer without dependants and answers 404 (without deleting) for another organization', async () => {
      const alpha = await organization('DelCustA'); const beta = await organization('DelCustB');
      const free = await customer(alpha); const foreign = await customer(beta);

      expect((await call('DELETE', `/api/customers/${foreign.id}`, alpha)).statusCode).toBe(404);
      expect(await db.customer.count({ where: { id: foreign.id } })).toBe(1);
      expect((await call('DELETE', `/api/customers/${free.id}`, alpha)).statusCode).toBe(204);
      expect(await db.customer.count({ where: { id: free.id } })).toBe(0);
    });

    it('answers 409 when a customer still has equipment or service orders, and removes nothing', async () => {
      const org = await organization('DelCustDeps'); const order = await serviceOrder(org);
      const withEquipmentOnly = await customer(org); await equipment(org, withEquipmentOnly.id);

      for (const id of [order.customerId, withEquipmentOnly.id]) {
        const response = await call('DELETE', `/api/customers/${id}`, org);
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ statusCode: 409, error: 'Conflict' });
        expect(response.body).not.toMatch(/prisma|constraint|foreign key|organizationId/i);
        expect(await db.customer.count({ where: { id } })).toBe(1);
      }
      expect(await db.serviceOrder.count({ where: { id: order.id } })).toBe(1);
      expect(await db.equipment.count({ where: { customerId: order.customerId } })).toBe(1);
    });

    it('deletes equipment without service orders, answers 409 when one references it, and 404 for another organization', async () => {
      const alpha = await organization('DelEquipA'); const beta = await organization('DelEquipB');
      const owner = await customer(alpha); const free = await equipment(alpha, owner.id);
      const used = await serviceOrder(alpha);
      const foreign = await equipment(beta, (await customer(beta)).id);

      expect((await call('DELETE', `/api/equipment/${foreign.id}`, alpha)).statusCode).toBe(404);
      expect(await db.equipment.count({ where: { id: foreign.id } })).toBe(1);
      const blocked = await call('DELETE', `/api/equipment/${used.equipmentId}`, alpha);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.body).not.toMatch(/prisma|constraint|foreign key|organizationId/i);
      expect(await db.equipment.count({ where: { id: used.equipmentId } })).toBe(1);
      expect((await call('DELETE', `/api/equipment/${free.id}`, alpha)).statusCode).toBe(204);
    });

    it('answers 409 when deleting a quote that still has items, keeps them, and allows it once empty', async () => {
      const org = await organization('DelQuote'); const order = await serviceOrder(org);
      await call('POST', `/api/service-orders/${order.id}/quote`, org, {});
      const created = await call('POST', `/api/service-orders/${order.id}/quote/items`, org, item('10.00'));

      const blocked = await call('DELETE', `/api/service-orders/${order.id}/quote`, org);
      expect(blocked.statusCode).toBe(409);
      expect(await db.serviceItem.count({ where: { quoteId: created.json().quote.id } })).toBe(1);

      await call('DELETE', `/api/service-orders/${order.id}/quote/items/${created.json().quote.items[0].id}`, org);
      expect((await call('DELETE', `/api/service-orders/${order.id}/quote`, org)).statusCode).toBe(204);
    });

    it('still answers 409 for a service order with related records', async () => {
      const org = await organization('DelOrder'); const order = await serviceOrder(org);
      await db.payment.create({ data: { organizationId: org.organizationId, serviceOrderId: order.id, amount: '10.00', status: 'PENDING', method: 'PIX' } });
      expect((await call('DELETE', `/api/service-orders/${order.id}`, org)).statusCode).toBe(409);
      expect(await db.serviceOrder.count({ where: { id: order.id } })).toBe(1);
    });

  });
});
