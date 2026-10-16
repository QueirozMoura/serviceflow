import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas). Nada aqui toca o banco de desenvolvimento.
const temporary: TemporaryDatabase = createTemporaryDatabase('overview');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { PrismaOverviewRepository } = await import('../../src/modules/overview/repository.js');
const { makeOrganizationSlug } = await import('../../src/modules/auth/service.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { env } = await import('../../src/config/env.js');

const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset));

describe('aggregated quotes, payments and warranties against a real PostgreSQL database', () => {
  let db: PrismaClient;
  let auth: InstanceType<typeof PrismaAuthRepository>;
  let app: FastifyInstance;
  let queries = 0;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: temporary.url } }, log: [{ emit: 'event', level: 'query' }] });
    (db as unknown as { $on: (event: string, listener: () => void) => void }).$on('query', () => { queries += 1; });
    auth = new PrismaAuthRepository(db);
    app = buildApp({ authRepository: auth, overviewRepository: new PrismaOverviewRepository(db) });
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
  async function organization(name: string) {
    const { user } = await auth.createOrganizationWithOwner({ organizationName: `Org ${name}`, slug: makeOrganizationSlug(`Org ${name}`), name: `${name} Owner`, email: `${name.toLowerCase()}-owner@example.com`, passwordHash: await bcrypt.hash('StrongPass1', 4) });
    const customer = await db.customer.create({ data: { organizationId: user.organizationId, name: `Cliente ${name}`, phone: `55-${name}-0000`, email: `${name.toLowerCase()}-cliente@example.com`, document: `DOC-${name}` } });
    const equipment = await db.equipment.create({ data: { organizationId: user.organizationId, customerId: customer.id, type: 'Notebook' } });
    return { organizationId: user.organizationId, customerId: customer.id, equipmentId: equipment.id, owner: await session(user.id, user.organizationId) };
  }
  async function member(organizationId: string, role: UserRole, name: string) {
    const user = await db.user.create({ data: { organizationId, name, email: `${name.toLowerCase()}@example.com`, role } });
    return session(user.id, organizationId);
  }
  type Org = Awaited<ReturnType<typeof organization>>;
  const order = (org: Org, number: string, createdAt: Date) => db.serviceOrder.create({ data: { organizationId: org.organizationId, customerId: org.customerId, equipmentId: org.equipmentId, orderNumber: number, status: 'DELIVERED', problemDescription: 'x', receivedAt: createdAt, createdAt } });
  const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
  const countQueries = async (url: string, cookie: string) => { const before = queries; const response = await get(url, cookie); expect(response.statusCode).toBe(200); return queries - before; };

  let alpha: Org; let beta: Org; let gamma: Org; let technician: string; let admin: string;

  beforeAll(async () => {
    alpha = await organization('Alpha');
    beta = await organization('Beta');
    gamma = await organization('Gamma');
    technician = await member(alpha.organizationId, UserRole.TECHNICIAN, 'Tecnico');
    admin = await member(alpha.organizationId, UserRole.ADMIN, 'Admin');

    const a1 = await order(alpha, 'A-1', day(0));
    const quote1 = await db.quote.create({ data: { serviceOrderId: a1.id, status: 'APPROVED', total: 300 } });
    for (const description of ['Tela', 'Mao de obra']) await db.serviceItem.create({ data: { quoteId: quote1.id, description, quantity: 1, unitPrice: 150, type: 'PART' } });
    await db.payment.create({ data: { organizationId: alpha.organizationId, serviceOrderId: a1.id, amount: 200, status: 'PAID', method: 'PIX', createdAt: day(1) } });
    await db.payment.create({ data: { organizationId: alpha.organizationId, serviceOrderId: a1.id, amount: 100, status: 'PENDING', method: 'CASH', createdAt: day(2) } });

    const a2 = await order(alpha, 'A-2', day(31));
    await db.quote.create({ data: { serviceOrderId: a2.id, status: 'PENDING', total: 50 } });
    await db.payment.create({ data: { organizationId: alpha.organizationId, serviceOrderId: a2.id, amount: 10, status: 'FAILED', method: 'CARD' } });

    const a3 = await order(alpha, 'A-3', day(59));
    await db.warranty.create({ data: { organizationId: alpha.organizationId, serviceOrderId: a3.id, startDate: day(60), endDate: new Date('2999-01-01'), description: 'Garantia vigente', status: 'ACTIVE' } });
    const a4 = await order(alpha, 'A-4', day(90));
    await db.warranty.create({ data: { organizationId: alpha.organizationId, serviceOrderId: a4.id, startDate: day(91), endDate: day(92), description: 'Garantia vencida', status: 'ACTIVE' } });
    await order(alpha, 'A-5', day(120));

    const b1 = await order(beta, 'B-SECRET-1', day(200));
    await db.quote.create({ data: { serviceOrderId: b1.id, status: 'PENDING', total: 999.99 } });
    await db.payment.create({ data: { organizationId: beta.organizationId, serviceOrderId: b1.id, amount: 777, status: 'PAID', method: 'TRANSFER' } });
    await db.warranty.create({ data: { organizationId: beta.organizationId, serviceOrderId: b1.id, startDate: day(201), endDate: new Date('2999-01-01'), description: 'Garantia secreta', status: 'ACTIVE' } });
  }, 120_000);

  describe('GET /api/quotes', () => {
    it('lists only the organization quotes, newest order first, with just the fields the screen uses', async () => {
      const response = await get('/api/quotes', alpha.owner);
      const { quotes } = response.json();

      expect(response.statusCode).toBe(200);
      expect(quotes.map((row: { serviceOrder: { orderNumber: string } }) => row.serviceOrder.orderNumber)).toEqual(['A-2', 'A-1']);
      expect(Object.keys(quotes[0]).sort()).toEqual(['quote', 'serviceOrder']);
      expect(Object.keys(quotes[0].serviceOrder).sort()).toEqual(['customer', 'id', 'orderNumber']);
      expect(Object.keys(quotes[0].serviceOrder.customer)).toEqual(['name']);
      expect(Object.keys(quotes[0].quote).sort()).toEqual(['id', 'itemsCount', 'status', 'total', 'updatedAt']);
      expect(quotes[1]).toMatchObject({ serviceOrder: { orderNumber: 'A-1', customer: { name: 'Cliente Alpha' } }, quote: { status: 'APPROVED', itemsCount: 2 } });
      expect(Number(quotes[1].quote.total)).toBe(300);
      expect(quotes[0].quote).toMatchObject({ status: 'PENDING', itemsCount: 0 });
      // Nada de dados pessoais do cliente nem de outra organizacao.
      expect(response.body).not.toMatch(/alpha-cliente@example\.com|55-Alpha|DOC-Alpha|Beta|B-SECRET|999\.99|organizationId/);
    });

    it('ignores identity and organization sent by the client', async () => {
      const response = await get(`/api/quotes?organizationId=${beta.organizationId}&role=OWNER&userId=x`, alpha.owner);
      expect(response.json().quotes).toHaveLength(2);
      expect(response.body).not.toContain('B-SECRET');
    });

    it('shows each organization only its own data, and nothing to an empty one', async () => {
      const betaQuotes = (await get('/api/quotes', beta.owner)).json().quotes;
      expect(betaQuotes).toHaveLength(1);
      expect(betaQuotes[0].serviceOrder.orderNumber).toBe('B-SECRET-1');
      expect(Number(betaQuotes[0].quote.total)).toBe(999.99);
      expect((await get('/api/quotes', gamma.owner)).json()).toEqual({ quotes: [] });
    });
  });

  describe('GET /api/payments', () => {
    it('groups payments by order, newest order first and newest payment first, without leaking other organizations', async () => {
      const response = await get('/api/payments', alpha.owner);
      const { payments } = response.json();

      expect(response.statusCode).toBe(200);
      expect(payments.map((row: { serviceOrder: { orderNumber: string } }) => row.serviceOrder.orderNumber)).toEqual(['A-2', 'A-1']);
      expect(Object.keys(payments[0]).sort()).toEqual(['payments', 'serviceOrder']);
      expect(Object.keys(payments[0].payments[0]).sort()).toEqual(['amount', 'id', 'method', 'status', 'updatedAt']);
      expect(payments[1].payments.map((payment: { status: string }) => payment.status)).toEqual(['PENDING', 'PAID']);
      expect(payments[1].payments.map((payment: { amount: string }) => Number(payment.amount))).toEqual([100, 200]);
      expect(payments[0].payments).toHaveLength(1);
      expect(response.body).not.toMatch(/alpha-cliente@example\.com|55-Alpha|DOC-Alpha|Beta|B-SECRET|777|organizationId/);
    });

    it('allows OWNER and ADMIN and forbids TECHNICIAN even through the aggregated endpoint', async () => {
      expect((await get('/api/payments', admin)).statusCode).toBe(200);
      const denied = await get('/api/payments', technician);
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ statusCode: 403, error: 'Forbidden', message: 'You do not have permission to perform this action' });
      expect(denied.body).not.toMatch(/A-1|A-2|amount/);
      expect((await get(`/api/payments?organizationId=${alpha.organizationId}`, technician)).statusCode).toBe(403);
    });

    it('isolates organizations and handles an empty one', async () => {
      const betaPayments = (await get('/api/payments', beta.owner)).json().payments;
      expect(betaPayments).toHaveLength(1);
      expect(Number(betaPayments[0].payments[0].amount)).toBe(777);
      expect((await get('/api/payments', gamma.owner)).json()).toEqual({ payments: [] });
    });
  });

  describe('GET /api/warranties', () => {
    it('lists warranties with the effective status and only the fields the screen uses', async () => {
      const response = await get('/api/warranties', alpha.owner);
      const { warranties } = response.json();

      expect(response.statusCode).toBe(200);
      expect(warranties.map((row: { serviceOrder: { orderNumber: string } }) => row.serviceOrder.orderNumber)).toEqual(['A-4', 'A-3']);
      expect(Object.keys(warranties[0].warranty).sort()).toEqual(['description', 'endDate', 'id', 'startDate', 'status', 'updatedAt']);
      // A-4 continua ACTIVE no banco, mas ja venceu: a listagem mostra o mesmo status efetivo das demais telas.
      expect((await db.warranty.findFirstOrThrow({ where: { description: 'Garantia vencida' } })).status).toBe('ACTIVE');
      expect(warranties[0].warranty.status).toBe('EXPIRED');
      expect(warranties[1].warranty.status).toBe('ACTIVE');
      expect(response.body).not.toMatch(/alpha-cliente@example\.com|55-Alpha|DOC-Alpha|Beta|secreta|organizationId/);
    });

    it('is available to the TECHNICIAN, isolates organizations and handles an empty one', async () => {
      expect((await get('/api/warranties', technician)).json().warranties).toHaveLength(2);
      expect((await get('/api/quotes', technician)).json().quotes).toHaveLength(2);
      const betaWarranties = (await get('/api/warranties', beta.owner)).json().warranties;
      expect(betaWarranties).toHaveLength(1);
      expect(betaWarranties[0].warranty.description).toBe('Garantia secreta');
      expect((await get('/api/warranties', gamma.owner)).json()).toEqual({ warranties: [] });
    });
  });

  it('requires authentication for every aggregated endpoint', async () => {
    for (const url of ['/api/quotes', '/api/payments', '/api/warranties']) {
      expect((await get(url)).statusCode, url).toBe(401);
      expect((await get(url, `${env.AUTH_COOKIE_NAME}=forged`)).statusCode, url).toBe(401);
    }
  });

  it('uses a constant number of queries no matter how many orders exist (no query per order)', async () => {
    const urls = ['/api/quotes', '/api/payments', '/api/warranties'];
    const before: number[] = [];
    for (const url of urls) before.push(await countQueries(url, alpha.owner));

    for (let i = 0; i < 20; i += 1) {
      const extra = await order(alpha, `BULK-${i}`, day(300 + i));
      await db.quote.create({ data: { serviceOrderId: extra.id, status: 'PENDING', total: 10 } });
      await db.payment.create({ data: { organizationId: alpha.organizationId, serviceOrderId: extra.id, amount: 5, status: 'PAID', method: 'PIX' } });
      await db.warranty.create({ data: { organizationId: alpha.organizationId, serviceOrderId: extra.id, startDate: day(301 + i), endDate: new Date('2999-01-01'), description: 'Bulk', status: 'ACTIVE' } });
    }

    const after: number[] = [];
    for (const url of urls) after.push(await countQueries(url, alpha.owner));
    expect(after).toEqual(before);
    for (const count of after) expect(count).toBeLessThanOrEqual(8);
    expect((await get('/api/quotes', alpha.owner)).json().quotes).toHaveLength(22);
    expect((await get('/api/payments', alpha.owner)).json().payments).toHaveLength(22);
    expect((await get('/api/warranties', alpha.owner)).json().warranties).toHaveLength(22);
    console.log(`QUERIES per aggregated request (auth included), 5 vs 25 orders: ${urls.map((url, i) => `${url}=${before[i]}->${after[i]}`).join(' ')}`);
  });
});
