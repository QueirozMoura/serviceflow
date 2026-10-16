import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole, type PaymentStatus, type QuoteStatus, type ServiceOrderStatus, type WarrantyStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas). Nada aqui toca o banco de desenvolvimento.
const temporary: TemporaryDatabase = createTemporaryDatabase('pagination');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { makeOrganizationSlug } = await import('../../src/modules/auth/service.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { env } = await import('../../src/config/env.js');

const T0 = Date.UTC(2026, 0, 1);
const minutes = (offset: number) => new Date(T0 + offset * 60_000);
const pad = (n: number) => String(n).padStart(2, '0');
const byNewest = <T extends { createdAt: Date; id: string }>(rows: T[]) => [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));

describe('pagination, search and filters against a real PostgreSQL database', () => {
  let db: PrismaClient;
  let auth: InstanceType<typeof PrismaAuthRepository>;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: temporary.url } } });
    auth = new PrismaAuthRepository(db);
    app = buildApp({ authRepository: auth });
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.$disconnect(); temporary.drop(); }, 60_000);

  async function session(userId: string, organizationId: string) {
    const { token, tokenHash } = createSessionToken();
    await auth.createSession({ tokenHash, userId, organizationId, expiresAt: sessionExpiresAt() });
    return `${env.AUTH_COOKIE_NAME}=${token}`;
  }
  async function organization(name: string) {
    const { user } = await auth.createOrganizationWithOwner({ organizationName: `Org ${name}`, slug: makeOrganizationSlug(`Org ${name}`), name: `${name} Owner`, email: `${name.toLowerCase()}-owner@example.com`, passwordHash: await bcrypt.hash('StrongPass1', 4) });
    const technician = await db.user.create({ data: { organizationId: user.organizationId, name: `Tec ${name}`, email: `tec-${name.toLowerCase()}@example.com`, role: UserRole.TECHNICIAN } });
    return { organizationId: user.organizationId, owner: await session(user.id, user.organizationId), technician: await session(technician.id, user.organizationId) };
  }
  const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const json = async (url: string, cookie: string) => { const response = await get(url, cookie); expect(response.statusCode, url).toBe(200); return response.json(); };
  async function walk<T>(base: string, cookie: string, key: string, pageSize: number): Promise<{ rows: T[]; pages: number }> {
    const separator = base.includes('?') ? '&' : '?';
    const first = await json(`${base}${separator}page=1&pageSize=${pageSize}`, cookie);
    const rows: T[] = [...first[key]];
    for (let page = 2; page <= first.pagination.totalPages; page += 1) rows.push(...(await json(`${base}${separator}page=${page}&pageSize=${pageSize}`, cookie))[key]);
    return { rows, pages: first.pagination.totalPages };
  }

  let alpha: Awaited<ReturnType<typeof organization>>; let beta: Awaited<ReturnType<typeof organization>>;
  let alphaCustomers: Array<{ id: string; name: string }> = []; let alphaOrders: Array<{ id: string; orderNumber: string; customerId: string; equipmentId: string; status: ServiceOrderStatus; createdAt: Date }> = [];
  let betaCustomerId = ''; let alphaEquipment: Array<{ id: string; customerId: string }> = [];
  const orderStatuses: ServiceOrderStatus[] = ['RECEIVED', 'WAITING_DIAGNOSIS', 'DELIVERED'];

  beforeAll(async () => {
    alpha = await organization('Alpha');
    beta = await organization('Beta');
    const a = alpha.organizationId; const b = beta.organizationId;

    // 45 clientes comuns (os 10 primeiros com a MESMA data de criacao, para exercitar o desempate) + 2 com curingas no nome.
    await db.customer.createMany({ data: [
      ...Array.from({ length: 45 }, (_, index) => { const n = index + 1; return { organizationId: a, name: `Cliente ${pad(n)}`, phone: `5511-A-${pad(n)}`, email: n % 2 ? `c${pad(n)}@alpha.test` : null, document: n % 5 === 0 ? `DOC-${pad(n)}` : null, createdAt: n <= 10 ? minutes(0) : minutes(n) }; }),
      { organizationId: a, name: '100%Real', phone: '5511-A-P1', createdAt: minutes(100) },
      { organizationId: a, name: '100xReal', phone: '5511-A-P2', createdAt: minutes(101) },
      ...Array.from({ length: 5 }, (_, index) => ({ organizationId: b, name: `Cliente B-${pad(index + 1)}`, phone: `5511-B-${pad(index + 1)}`, email: 'b@beta.test', createdAt: minutes(index) })),
      { organizationId: b, name: 'Cliente 01 Secreto', phone: '5511-B-99', createdAt: minutes(50) },
    ] });
    alphaCustomers = (await db.customer.findMany({ where: { organizationId: a, name: { startsWith: 'Cliente ' } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }));
    betaCustomerId = (await db.customer.findFirstOrThrow({ where: { organizationId: b, name: 'Cliente B-01' } })).id;

    // 20 equipamentos (2 para cada um dos 10 primeiros clientes) + 3 da outra organizacao, tambem Dell.
    await db.equipment.createMany({ data: [
      ...alphaCustomers.slice(0, 10).flatMap((customer, index) => [0, 1].map((k) => ({ organizationId: a, customerId: customer.id, type: k ? 'Impressora' : 'Notebook', brand: (index + k) % 2 ? 'HP' : 'Dell', model: `M-${pad(index)}${k}`, serialNumber: `SN-${pad(index)}-${k}`, createdAt: index < 4 ? minutes(0) : minutes(10 + index * 2 + k) }))),
      ...Array.from({ length: 3 }, (_, index) => ({ organizationId: b, customerId: betaCustomerId, type: 'Notebook', brand: 'Dell', model: `B-${index}`, serialNumber: `SNB-${index}`, createdAt: minutes(index) })),
    ] });
    alphaEquipment = await db.equipment.findMany({ where: { organizationId: a }, select: { id: true, customerId: true } });
    const betaEquipment = await db.equipment.findFirstOrThrow({ where: { organizationId: b } });

    // 30 OS (8 com a mesma data) + 4 da outra organizacao.
    await db.serviceOrder.createMany({ data: [
      ...Array.from({ length: 30 }, (_, index) => { const customer = alphaCustomers[index % 10]!; const equipment = alphaEquipment.find((item) => item.customerId === customer.id)!; return { organizationId: a, customerId: customer.id, equipmentId: equipment.id, orderNumber: `OS-A-${pad(index + 1)}`, status: orderStatuses[index % 3]!, problemDescription: 'x', receivedAt: minutes(0), createdAt: index < 8 ? minutes(0) : minutes(index) }; }),
      ...Array.from({ length: 4 }, (_, index) => ({ organizationId: b, customerId: betaCustomerId, equipmentId: betaEquipment.id, orderNumber: `OS-B-${pad(index + 1)}`, status: 'RECEIVED' as const, problemDescription: 'x', receivedAt: minutes(0), createdAt: minutes(index) })),
    ] });
    alphaOrders = await db.serviceOrder.findMany({ where: { organizationId: a }, orderBy: { orderNumber: 'asc' }, select: { id: true, orderNumber: true, customerId: true, equipmentId: true, status: true, createdAt: true } });
    const betaOrder = await db.serviceOrder.findFirstOrThrow({ where: { organizationId: b } });

    // Orcamentos (25), pagamentos (15 OS), garantias (12) na Alpha; um de cada na Beta.
    await db.quote.createMany({ data: [
      ...alphaOrders.slice(0, 25).map((order, index) => ({ serviceOrderId: order.id, status: (index < 10 ? 'PENDING' : index < 20 ? 'APPROVED' : 'REJECTED') as QuoteStatus, total: (index + 1) * 10 })),
      { serviceOrderId: betaOrder.id, status: 'PENDING', total: 999 },
    ] });
    const paymentStatuses: PaymentStatus[] = ['PAID', 'PENDING', 'FAILED'];
    await db.payment.createMany({ data: [
      { organizationId: a, serviceOrderId: alphaOrders[0]!.id, amount: 100, status: 'PAID', method: 'PIX', createdAt: minutes(1) },
      { organizationId: a, serviceOrderId: alphaOrders[0]!.id, amount: 50, status: 'PENDING', method: 'CASH', createdAt: minutes(2) },
      ...alphaOrders.slice(1, 15).map((order, index) => ({ organizationId: a, serviceOrderId: order.id, amount: [20, 30, 40][index % 3]!, status: paymentStatuses[index % 3]!, method: 'PIX' as const, createdAt: minutes(3) })),
      { organizationId: b, serviceOrderId: betaOrder.id, amount: 777, status: 'PAID', method: 'TRANSFER' },
    ] });
    const future = new Date('2999-01-01'); const past = new Date('2020-01-01');
    await db.warranty.createMany({ data: [
      ...alphaOrders.slice(0, 12).map((order, index) => ({ organizationId: a, serviceOrderId: order.id, startDate: new Date('2019-01-01'), endDate: index < 4 ? future : index < 7 ? past : new Date('2020-06-01'), description: `Garantia ${pad(index)}`, status: (index < 7 ? 'ACTIVE' : index < 9 ? 'EXPIRED' : 'CANCELLED') as WarrantyStatus })),
      { organizationId: b, serviceOrderId: betaOrder.id, startDate: new Date('2019-01-01'), endDate: future, description: 'Garantia da Beta', status: 'ACTIVE' },
    ] });
  }, 180_000);

  describe('customers', () => {
    it('returns the first page with metadata and walks every page without gaps, repeats or reordering', async () => {
      const first = await json('/api/customers', alpha.owner);
      expect(first.customers).toHaveLength(20);
      expect(first.pagination).toEqual({ page: 1, pageSize: 20, total: 47, totalPages: 3 });

      const { rows, pages } = await walk<{ id: string }>('/api/customers', alpha.owner, 'customers', 20);
      const expected = byNewest(await db.customer.findMany({ where: { organizationId: alpha.organizationId } })).map((customer) => customer.id);
      expect(pages).toBe(3);
      expect(rows.map((row) => row.id)).toEqual(expected);
      expect(new Set(rows.map((row) => row.id)).size).toBe(47);
    });

    it('keeps the order stable across page sizes, including rows that share the same creation date', async () => {
      const expected = byNewest(await db.customer.findMany({ where: { organizationId: alpha.organizationId } })).map((customer) => customer.id);
      for (const pageSize of [1, 7, 10, 47, 100]) {
        const { rows } = await walk<{ id: string }>('/api/customers', alpha.owner, 'customers', pageSize);
        expect(rows.map((row) => row.id), `pageSize=${pageSize}`).toEqual(expected);
      }
    });

    it('returns an empty page past the end with correct metadata, and honours the maximum page size', async () => {
      const beyond = await json('/api/customers?page=9&pageSize=20', alpha.owner);
      expect(beyond.customers).toEqual([]);
      expect(beyond.pagination).toEqual({ page: 9, pageSize: 20, total: 47, totalPages: 3 });
      const all = await json('/api/customers?pageSize=100', alpha.owner);
      expect(all.customers).toHaveLength(47);
      expect(all.pagination).toEqual({ page: 1, pageSize: 100, total: 47, totalPages: 1 });
      expect((await get('/api/customers?pageSize=101', alpha.owner)).statusCode).toBe(400);
    });

    it('searches name, e-mail, phone and document case-insensitively, and counts only the matches', async () => {
      const byName = await json('/api/customers?q=CLIENTE%200', alpha.owner);
      expect(byName.pagination.total).toBe(9);
      expect(byName.customers.every((customer: { name: string }) => /^Cliente 0/.test(customer.name))).toBe(true);
      expect((await json('/api/customers?q=%40alpha.test', alpha.owner)).pagination.total).toBe(23);
      expect((await json('/api/customers?q=5511-a-07', alpha.owner)).pagination.total).toBe(1);
      expect((await json('/api/customers?q=doc-1', alpha.owner)).pagination.total).toBe(2);
      expect((await json('/api/customers?q=   ', alpha.owner)).pagination.total).toBe(47);
    });

    it('combines search with pagination and keeps the totals consistent with the filter', async () => {
      const page1 = await json('/api/customers?q=cliente%201&pageSize=4', alpha.owner);
      expect(page1.pagination).toEqual({ page: 1, pageSize: 4, total: 10, totalPages: 3 });
      const { rows } = await walk<{ id: string; name: string }>('/api/customers?q=cliente%201', alpha.owner, 'customers', 4);
      expect(rows).toHaveLength(10);
      expect(rows.every((row) => row.name.toLowerCase().includes('cliente 1'))).toBe(true);
      const empty = await json('/api/customers?q=nao-existe', alpha.owner);
      expect(empty.customers).toEqual([]);
      expect(empty.pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    });

    it('treats % and _ in the search as literal characters', async () => {
      const percent = await json('/api/customers?q=%25', alpha.owner);
      expect(percent.pagination.total).toBe(1);
      expect(percent.customers[0].name).toBe('100%Real');
      expect((await json('/api/customers?q=100_', alpha.owner)).pagination.total).toBe(0);
      expect((await json('/api/customers?q=_', alpha.owner)).pagination.total).toBe(0);
    });

    it('never counts or returns another organization\'s customers, whatever the search or the forged parameters', async () => {
      expect((await json('/api/customers?q=Secreto', alpha.owner)).pagination.total).toBe(0);
      expect((await json('/api/customers?q=B-0', alpha.owner)).pagination.total).toBe(0);
      const forged = await json(`/api/customers?organizationId=${beta.organizationId}&q=Secreto`, alpha.owner);
      expect(forged.customers).toEqual([]);
      expect((await json('/api/customers?q=Secreto', beta.owner)).pagination.total).toBe(1);
      expect((await json('/api/customers', beta.owner)).pagination).toEqual({ page: 1, pageSize: 20, total: 6, totalPages: 1 });
      const all = await walk<{ name: string }>('/api/customers', alpha.owner, 'customers', 100);
      expect(all.rows.some((row) => /B-0|Secreto/.test(row.name))).toBe(false);
    });

    it('serves the complete lightweight options list for selectors, without extra fields or other organizations', async () => {
      const { customers } = await json('/api/customers/options', alpha.owner);
      expect(customers).toHaveLength(47);
      expect(Object.keys(customers[0]).sort()).toEqual(['id', 'name', 'phone']);
      expect((await json('/api/customers/options', alpha.owner)).customers).toEqual(customers);
      expect(JSON.stringify(customers)).not.toMatch(/alpha\.test|DOC-|Secreto|B-0/);
      expect((await json('/api/customers/options', beta.owner)).customers).toHaveLength(6);
      expect((await json('/api/customers/options', alpha.technician)).customers).toHaveLength(47);
    });

    it('lets the technician list and search', async () => {
      const technician = await json('/api/customers?q=cliente%2001', alpha.technician);
      expect(technician.pagination.total).toBe(1);
    });
  });

  describe('equipment', () => {
    it('paginates, filters by customer and searches across type, brand, model, serial and customer name', async () => {
      const first = await json('/api/equipment?pageSize=8', alpha.owner);
      expect(first.pagination).toEqual({ page: 1, pageSize: 8, total: 20, totalPages: 3 });
      const expected = byNewest(await db.equipment.findMany({ where: { organizationId: alpha.organizationId } })).map((item) => item.id);
      const { rows } = await walk<{ id: string }>('/api/equipment', alpha.owner, 'equipment', 8);
      expect(rows.map((row) => row.id)).toEqual(expected);

      const customerOne = alphaCustomers[0]!;
      const filtered = await json(`/api/equipment?customerId=${customerOne.id}`, alpha.owner);
      expect(filtered.pagination.total).toBe(2);
      expect(filtered.equipment.every((item: { customerId: string }) => item.customerId === customerOne.id)).toBe(true);
      expect((await json('/api/equipment?q=impressora', alpha.owner)).pagination.total).toBe(10);
      expect((await json('/api/equipment?q=SN-03', alpha.owner)).pagination.total).toBe(2);
      expect((await json(`/api/equipment?q=${encodeURIComponent('Cliente 02')}`, alpha.owner)).pagination.total).toBe(2);
      const combined = await json(`/api/equipment?customerId=${customerOne.id}&q=impressora`, alpha.owner);
      expect(combined.pagination.total).toBe(1);
    });

    it('never leaks another organization through search, customer filter, totals or forged parameters', async () => {
      const dell = await json('/api/equipment?q=dell&pageSize=100', alpha.owner);
      expect(dell.pagination.total).toBe(10);
      expect(JSON.stringify(dell)).not.toMatch(/SNB-|B-\d/);
      expect((await json('/api/equipment?q=dell', beta.owner)).pagination.total).toBe(3);
      expect((await get(`/api/equipment?customerId=${betaCustomerId}`, alpha.owner)).statusCode).toBe(400);
      expect((await json(`/api/equipment?organizationId=${beta.organizationId}&q=SNB-`, alpha.owner)).pagination.total).toBe(0);
    });

    it('serves the per-customer options list, limited to that customer and organization', async () => {
      const customer = alphaCustomers[0]!;
      const { equipment } = await json(`/api/equipment/options?customerId=${customer.id}`, alpha.technician);
      expect(equipment).toHaveLength(2);
      expect(Object.keys(equipment[0]).sort()).toEqual(['brand', 'customerId', 'id', 'model', 'serialNumber', 'type']);
      expect(equipment.every((item: { customerId: string }) => item.customerId === customer.id)).toBe(true);
      expect((await get(`/api/equipment/options?customerId=${betaCustomerId}`, alpha.owner)).statusCode).toBe(400);
      expect((await get('/api/equipment/options', alpha.owner)).statusCode).toBe(400);
    });
  });

  describe('service orders', () => {
    it('paginates with a stable order, including orders that share the same creation date', async () => {
      const first = await json('/api/service-orders?pageSize=12', alpha.owner);
      expect(first.pagination).toEqual({ page: 1, pageSize: 12, total: 30, totalPages: 3 });
      const expected = byNewest(alphaOrders).map((order) => order.id);
      for (const pageSize of [5, 12, 30, 100]) {
        const { rows } = await walk<{ id: string }>('/api/service-orders', alpha.owner, 'serviceOrders', pageSize);
        expect(rows.map((row) => row.id), `pageSize=${pageSize}`).toEqual(expected);
      }
      const beyond = await json('/api/service-orders?page=5&pageSize=12', alpha.owner);
      expect(beyond.serviceOrders).toEqual([]);
      expect(beyond.pagination.total).toBe(30);
    });

    it('filters by status and counts exactly the matching orders', async () => {
      for (const status of orderStatuses) {
        const body = await json(`/api/service-orders?status=${status}&pageSize=100`, alpha.owner);
        expect(body.pagination.total).toBe(10);
        expect(body.serviceOrders.every((order: { status: string }) => order.status === status)).toBe(true);
      }
      expect((await json('/api/service-orders?status=CANCELLED', alpha.owner)).pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    });

    it('searches order number, customer and equipment, and combines search, status and pagination', async () => {
      expect((await json('/api/service-orders?q=os-a-07', alpha.owner)).pagination.total).toBe(1);
      expect((await json('/api/service-orders?q=OS-A-1', alpha.owner)).pagination.total).toBe(10);
      expect((await json(`/api/service-orders?q=${encodeURIComponent('Cliente 03')}`, alpha.owner)).pagination.total).toBe(3);
      expect((await json('/api/service-orders?q=impressora', alpha.owner)).pagination.total).toBe(0);
      expect((await json('/api/service-orders?q=dell', alpha.owner)).pagination.total).toBeGreaterThan(0);

      const combined = await json('/api/service-orders?q=OS-A-&status=DELIVERED&pageSize=4', alpha.owner);
      expect(combined.pagination).toEqual({ page: 1, pageSize: 4, total: 10, totalPages: 3 });
      const { rows } = await walk<{ status: string; orderNumber: string }>('/api/service-orders?q=OS-A-&status=DELIVERED', alpha.owner, 'serviceOrders', 4);
      expect(rows).toHaveLength(10);
      expect(rows.every((row) => row.status === 'DELIVERED' && row.orderNumber.startsWith('OS-A-'))).toBe(true);
    });

    it('filters by customer and equipment', async () => {
      const customer = alphaCustomers[0]!;
      const expected = alphaOrders.filter((order) => order.customerId === customer.id);
      expect((await json(`/api/service-orders?customerId=${customer.id}`, alpha.owner)).pagination.total).toBe(expected.length);
      expect((await json(`/api/service-orders?equipmentId=${expected[0]!.equipmentId}`, alpha.owner)).pagination.total).toBe(expected.length);
      expect((await json(`/api/service-orders?customerId=${customer.id}&status=${expected[0]!.status}`, alpha.owner)).pagination.total).toBe(expected.filter((order) => order.status === expected[0]!.status).length);
    });

    it('never leaks another organization through search, filters, totals or forged parameters', async () => {
      expect((await json('/api/service-orders?q=OS-B', alpha.owner)).pagination.total).toBe(0);
      expect((await json(`/api/service-orders?customerId=${betaCustomerId}`, alpha.owner)).pagination.total).toBe(0);
      expect((await json(`/api/service-orders?organizationId=${beta.organizationId}&q=OS-B`, alpha.owner)).serviceOrders).toEqual([]);
      expect((await json('/api/service-orders?status=RECEIVED', beta.owner)).pagination.total).toBe(4);
      expect((await json('/api/service-orders', beta.owner)).pagination.total).toBe(4);
    });

    it('lets the technician list and filter', async () => {
      expect((await json('/api/service-orders?status=DELIVERED', alpha.technician)).pagination.total).toBe(10);
    });
  });

  describe('quotes', () => {
    it('paginates one row per order, newest order first, with the count and the global summary computed in the database', async () => {
      const first = await json('/api/quotes?pageSize=10', alpha.owner);
      expect(first.pagination).toEqual({ page: 1, pageSize: 10, total: 25, totalPages: 3 });
      const expected = byNewest(alphaOrders.slice(0, 25)).map((order) => order.orderNumber);
      const { rows } = await walk<{ serviceOrder: { id: string; orderNumber: string } }>('/api/quotes', alpha.owner, 'quotes', 10);
      expect(rows.map((row) => row.serviceOrder.orderNumber)).toEqual(expected);
      // 10 pendentes; aprovados 110..200 => 1550; total geral 10+20+...+250 = 3250.
      expect(first.summary).toEqual({ pendingCount: 10, approvedTotal: '1550.00', totalValue: '3250.00' });
    });

    it('filters by status and searches by order or customer, while the summary keeps describing the whole organization', async () => {
      const approved = await json('/api/quotes?status=APPROVED', alpha.owner);
      expect(approved.pagination.total).toBe(10);
      expect(approved.quotes.every((row: { quote: { status: string } }) => row.quote.status === 'APPROVED')).toBe(true);
      expect(approved.summary).toEqual({ pendingCount: 10, approvedTotal: '1550.00', totalValue: '3250.00' });
      expect((await json('/api/quotes?q=os-a-03', alpha.owner)).pagination.total).toBe(1);
      // Cliente 01 tem as OS de indice 0, 10 e 20 (orcamentos PENDING, APPROVED e REJECTED).
      expect((await json(`/api/quotes?q=${encodeURIComponent('Cliente 01')}`, alpha.owner)).pagination.total).toBe(3);
      expect((await json(`/api/quotes?q=${encodeURIComponent('Cliente 01')}&status=PENDING`, alpha.owner)).pagination.total).toBe(1);
      const none = await json('/api/quotes?status=EXPIRED', alpha.owner);
      expect(none.quotes).toEqual([]);
      expect(none.pagination.total).toBe(0);
    });

    it('does not mix organizations in rows, counts or summaries', async () => {
      const beta_ = await json('/api/quotes', beta.owner);
      expect(beta_.pagination.total).toBe(1);
      expect(beta_.summary).toEqual({ pendingCount: 1, approvedTotal: '0.00', totalValue: '999.00' });
      const alpha_ = await json('/api/quotes?pageSize=100', alpha.owner);
      expect(JSON.stringify(alpha_)).not.toMatch(/OS-B|999/);
      expect((await json(`/api/quotes?organizationId=${beta.organizationId}`, alpha.owner)).summary.totalValue).toBe('3250.00');
      expect((await json('/api/quotes?q=OS-B', alpha.owner)).pagination.total).toBe(0);
    });

    it('lets the technician list quotes', async () => {
      expect((await json('/api/quotes?status=PENDING', alpha.technician)).pagination.total).toBe(10);
    });
  });

  describe('payments', () => {
    it('paginates by order, keeps all payments of each order in its row and sums only paid ones as received', async () => {
      const first = await json('/api/payments?pageSize=5', alpha.owner);
      expect(first.pagination).toEqual({ page: 1, pageSize: 5, total: 15, totalPages: 3 });
      const { rows } = await walk<{ serviceOrder: { orderNumber: string }; payments: Array<{ status: string }> }>('/api/payments', alpha.owner, 'payments', 5);
      expect(rows.map((row) => row.serviceOrder.orderNumber)).toEqual(byNewest(alphaOrders.slice(0, 15)).map((order) => order.orderNumber));
      const withTwo = rows.find((row) => row.serviceOrder.orderNumber === 'OS-A-01')!;
      expect(withTwo.payments.map((payment) => payment.status)).toEqual(['PENDING', 'PAID']);
      // Pagos: 100 + (idx 0,3,6,9,12 => 20 cada = 100) = 200; pendentes: 50 + (idx 1,4,7,10,13 => 30 cada = 150) = 200; falhos nao entram.
      expect(first.summary).toEqual({ paidTotal: '200.00', pendingTotal: '200.00', count: 16 });
    });

    it('filters by payment status without cutting the payments of the order and without touching the summary', async () => {
      const failed = await json('/api/payments?status=FAILED&pageSize=100', alpha.owner);
      expect(failed.pagination.total).toBe(4);
      expect(failed.payments.every((row: { payments: Array<{ status: string }> }) => row.payments.some((payment) => payment.status === 'FAILED'))).toBe(true);
      expect(failed.summary.paidTotal).toBe('200.00');
      const paid = await json('/api/payments?status=PAID&pageSize=100', alpha.owner);
      expect(paid.pagination.total).toBe(6);
      expect(paid.payments.find((row: { serviceOrder: { orderNumber: string } }) => row.serviceOrder.orderNumber === 'OS-A-01').payments).toHaveLength(2);
      expect((await json('/api/payments?status=REFUNDED', alpha.owner)).payments).toEqual([]);
      expect((await json('/api/payments?q=os-a-02', alpha.owner)).pagination.total).toBe(1);
      expect((await json(`/api/payments?q=${encodeURIComponent('Cliente 01')}&status=PAID`, alpha.owner)).pagination.total).toBe(2);
    });

    it('keeps payments closed to the technician even with pagination, search and filters', async () => {
      for (const url of ['/api/payments', '/api/payments?page=1&pageSize=5', '/api/payments?q=os&status=PAID', '/api/payments?page=0']) {
        const response = await get(url, alpha.technician);
        expect(response.statusCode, url).toBe(403);
        expect(response.body).not.toMatch(/OS-A|amount|summary/);
      }
      expect((await get('/api/payments', alpha.owner)).statusCode).toBe(200);
    });

    it('does not mix organizations in rows, counts or totals', async () => {
      const betaPayments = await json('/api/payments', beta.owner);
      expect(betaPayments.pagination.total).toBe(1);
      expect(betaPayments.summary).toEqual({ paidTotal: '777.00', pendingTotal: '0.00', count: 1 });
      const alphaPayments = await json('/api/payments?pageSize=100', alpha.owner);
      expect(JSON.stringify(alphaPayments)).not.toMatch(/OS-B|777/);
      expect((await json(`/api/payments?organizationId=${beta.organizationId}`, alpha.owner)).summary.paidTotal).toBe('200.00');
    });
  });

  describe('warranties', () => {
    it('paginates and reports the effective status counts in the summary', async () => {
      const first = await json('/api/warranties?pageSize=5', alpha.owner);
      expect(first.pagination).toEqual({ page: 1, pageSize: 5, total: 12, totalPages: 3 });
      const { rows } = await walk<{ serviceOrder: { orderNumber: string } }>('/api/warranties', alpha.owner, 'warranties', 5);
      expect(rows.map((row) => row.serviceOrder.orderNumber)).toEqual(byNewest(alphaOrders.slice(0, 12)).map((order) => order.orderNumber));
      // 4 vigentes; vencidas = 3 (ACTIVE com data passada) + 2 (EXPIRED); 3 canceladas.
      expect(first.summary).toEqual({ active: 4, expired: 5, total: 12 });
    });

    it('filters by effective status (an ACTIVE warranty past its end date is listed as expired)', async () => {
      const active = await json('/api/warranties?status=ACTIVE&pageSize=100', alpha.owner);
      expect(active.pagination.total).toBe(4);
      expect(active.warranties.every((row: { warranty: { status: string } }) => row.warranty.status === 'ACTIVE')).toBe(true);
      const expired = await json('/api/warranties?status=EXPIRED&pageSize=100', alpha.owner);
      expect(expired.pagination.total).toBe(5);
      expect(expired.warranties.every((row: { warranty: { status: string } }) => row.warranty.status === 'EXPIRED')).toBe(true);
      const cancelled = await json('/api/warranties?status=CANCELLED&pageSize=100', alpha.owner);
      expect(cancelled.pagination.total).toBe(3);
      expect(active.summary).toEqual({ active: 4, expired: 5, total: 12 });
      const searched = await json('/api/warranties?q=os-a-02&status=ACTIVE', alpha.owner);
      expect(searched.pagination.total).toBe(1);
    });

    it('does not mix organizations and is available to the technician', async () => {
      const betaWarranties = await json('/api/warranties', beta.owner);
      expect(betaWarranties.pagination.total).toBe(1);
      expect(betaWarranties.summary).toEqual({ active: 1, expired: 0, total: 1 });
      expect(JSON.stringify(await json('/api/warranties?pageSize=100', alpha.owner))).not.toMatch(/OS-B|da Beta/);
      expect((await json('/api/warranties?status=ACTIVE', alpha.technician)).pagination.total).toBe(4);
    });
  });

  it('requires authentication on every paginated and options endpoint', async () => {
    const customerId = alphaCustomers[0]!.id;
    for (const url of ['/api/customers', '/api/customers/options', '/api/equipment', `/api/equipment/options?customerId=${customerId}`, '/api/service-orders', '/api/quotes', '/api/payments', '/api/warranties']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
      expect((await app.inject({ method: 'GET', url: `${url}${url.includes('?') ? '&' : '?'}page=1`, headers: { cookie: `${env.AUTH_COOKIE_NAME}=forged` } })).statusCode, url).toBe(401);
    }
  });
});
