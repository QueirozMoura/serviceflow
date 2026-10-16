import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
const { createSessionToken, sessionExpiresAt } = await import('../src/modules/auth/session.js');

class MemoryAuthRepository implements AuthRepository {
  private users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord>();
  async createOrganizationWithOwner(): Promise<CreatedAccount> { throw new Error('not used'); }
  findUsersByEmail(): Promise<AuthUserRecord[]> { return Promise.resolve([]); }
  findUserById(id: string): Promise<AuthUserRecord | null> { return Promise.resolve(this.users.find((user) => user.id === id) ?? null); }
  async updateUserName(): Promise<AuthUserRecord | null> { return null; }
  async createSession(input: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void> { const user = this.users.find((candidate) => candidate.id === input.userId)!; this.sessions.set(input.tokenHash, { expiresAt: input.expiresAt, user: { id: user.id, organizationId: user.organizationId, role: user.role } }); }
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> { return Promise.resolve(this.sessions.get(tokenHash) ?? null); }
  async revokeSession(): Promise<void> { return undefined; }
  findUserByOAuthAccount(): Promise<AuthUserRecord | null> { return Promise.resolve(null); }
  async linkOAuthAccount(): Promise<void> { return undefined; }
  createOrganizationWithOAuthUser(): Promise<CreatedAccount> { throw new Error('not used'); }
  async seed(role: UserRole, organizationId: string) {
    const id = `user-${this.users.length + 1}`;
    this.users.push({ id, organizationId, name: id, email: `${id}@example.com`, passwordHash: 'hash', role, organization: { id: organizationId, name: organizationId, slug: organizationId } });
    const { token, tokenHash } = createSessionToken();
    await this.createSession({ tokenHash, userId: id, organizationId, expiresAt: sessionExpiresAt() });
    return `${env.AUTH_COOKIE_NAME}=${token}`;
  }
}

// Repositorio que registra cada chamada com seus argumentos. Respostas vazias, mas no formato esperado pelas rotas.
type Call = { method: string; args: unknown[] };
const calls: Call[] = [];
function recordingRepository<T>(): T {
  const emptyPage = { items: [], total: 0 };
  const results: Record<string, unknown> = {
    list: emptyPage, listOptions: [], customerBelongsToOrganization: true,
    listQuotes: { ...emptyPage, summary: { pendingCount: 0, approvedTotal: '0.00', totalValue: '0.00' } },
    listPayments: { ...emptyPage, summary: { paidTotal: '0.00', pendingTotal: '0.00', count: 0 } },
    listWarranties: { ...emptyPage, summary: { active: 0, expired: 0, total: 0 } },
  };
  return new Proxy({}, { get: (_target, property) => (property === 'then' ? undefined : async (...args: unknown[]) => { calls.push({ method: String(property), args }); return results[String(property)] ?? null; }) }) as T;
}

const customerId = '11111111-1111-4111-8111-111111111111';
const lists = [
  { name: 'customers', url: '/api/customers', key: 'customers', method: 'list', filter: {} },
  { name: 'equipment', url: '/api/equipment', key: 'equipment', method: 'list', filter: { customerId } },
  { name: 'service orders', url: '/api/service-orders', key: 'serviceOrders', method: 'list', filter: { status: 'RECEIVED', customerId } },
  { name: 'quotes', url: '/api/quotes', key: 'quotes', method: 'listQuotes', filter: { status: 'PENDING' } },
  { name: 'payments', url: '/api/payments', key: 'payments', method: 'listPayments', filter: { status: 'PAID' } },
  { name: 'warranties', url: '/api/warranties', key: 'warranties', method: 'listWarranties', filter: { status: 'EXPIRED' } },
] as const;

describe('list endpoints: query validation and trusted scope', () => {
  let app: FastifyInstance;
  let auth: MemoryAuthRepository;

  beforeEach(async () => {
    calls.length = 0;
    auth = new MemoryAuthRepository();
    app = buildApp({
      authRepository: auth, customerRepository: recordingRepository(), equipmentRepository: recordingRepository(), serviceOrderRepository: recordingRepository(),
      overviewRepository: recordingRepository(),
    });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const query = (params: Record<string, string | string[]>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
    return `?${search.toString()}`;
  };

  describe.each(lists)('GET $url', ({ url, key, method, filter }) => {
    it('answers 401 without a session and never reaches the repository', async () => {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: `${url}${query({ page: '1' })}`, headers: { cookie: `${env.AUTH_COOKIE_NAME}=forged` } })).statusCode).toBe(401);
      expect(calls).toEqual([]);
    });

    it('returns the list with default pagination metadata', async () => {
      const cookie = await auth.seed(UserRole.OWNER, 'org-a');
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });

      expect(response.statusCode).toBe(200);
      expect(response.json()[key]).toEqual([]);
      expect(response.json().pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    });

    it.each([
      ['page=0', { page: '0' }], ['page=-1', { page: '-1' }], ['page=abc', { page: 'abc' }], ['page=1.5', { page: '1.5' }],
      ['pageSize=0', { pageSize: '0' }], ['pageSize=101', { pageSize: '101' }], ['pageSize=all', { pageSize: 'all' }],
      ['repeated page', { page: ['1', '2'] }], ['q too long', { q: 'x'.repeat(101) }], ['repeated q', { q: ['a', 'b'] }],
    ])('rejects %s with 400 before touching the repository', async (_label, params) => {
      const cookie = await auth.seed(UserRole.OWNER, 'org-a');
      const response = await app.inject({ method: 'GET', url: `${url}${query(params)}`, headers: { cookie } });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(calls.filter((call) => call.method === method)).toEqual([]);
    });

    it('passes validated filters and the organization of the session, ignoring forged scope and sorting parameters', async () => {
      const cookie = await auth.seed(UserRole.OWNER, 'org-a');
      const response = await app.inject({ method: 'GET', url: `${url}${query({ page: '2', pageSize: '50', q: '  dell  ', ...filter, organizationId: 'org-b', orderBy: 'name', sort: 'asc', skip: '999', take: '999' })}`, headers: { cookie } });

      expect(response.statusCode).toBe(200);
      expect(response.json().pagination).toMatchObject({ page: 2, pageSize: 50 });
      const call = calls.find((candidate) => candidate.method === method)!;
      expect(call.args[0]).toBe('org-a');
      const forwarded = call.args[1] as Record<string, unknown>;
      expect(forwarded).toMatchObject({ page: 2, pageSize: 50, q: 'dell', ...filter });
      expect(Object.keys(forwarded)).not.toEqual(expect.arrayContaining(['organizationId']));
      for (const forbidden of ['orderBy', 'sort', 'skip', 'take']) expect(forwarded).not.toHaveProperty(forbidden);
    });

    it('treats an empty search as no search', async () => {
      const cookie = await auth.seed(UserRole.OWNER, 'org-a');
      await app.inject({ method: 'GET', url: `${url}${query({ q: '   ' })}`, headers: { cookie } });
      expect((calls.find((candidate) => candidate.method === method)!.args[1] as { q?: string }).q).toBeUndefined();
    });
  });

  describe('invalid filter values', () => {
    it.each([
      ['/api/service-orders?status=NOT_A_STATUS'], ['/api/service-orders?customerId=not-a-uuid'], ['/api/service-orders?equipmentId=%27%20OR%201%3D1'],
      ['/api/quotes?status=SENT'], ['/api/payments?status=paid'], ['/api/warranties?status=ACTIVE,EXPIRED'],
    ])('rejects %s with 400', async (url) => {
      const cookie = await auth.seed(UserRole.OWNER, 'org-a');
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(response.statusCode).toBe(400);
      expect(calls.filter((call) => call.method.startsWith('list'))).toEqual([]);
    });

    it.each([['/api/equipment?customerId=not-a-uuid'], ['/api/equipment/options'], ['/api/equipment/options?customerId=nope']])('rejects %s with 400', async (url) => {
      const cookie = await auth.seed(UserRole.OWNER, 'org-a');
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe('Customer not found');
      expect(calls.filter((call) => call.method === 'list' || call.method === 'listOptions')).toEqual([]);
    });
  });

  describe('options endpoints for selectors', () => {
    it('requires a session and returns the lightweight lists for the organization of the session', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/customers/options' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: `/api/equipment/options?customerId=${customerId}` })).statusCode).toBe(401);

      const cookie = await auth.seed(UserRole.TECHNICIAN, 'org-a');
      expect((await app.inject({ method: 'GET', url: '/api/customers/options?organizationId=org-b', headers: { cookie } })).json()).toEqual({ customers: [] });
      expect(calls.find((call) => call.method === 'listOptions')!.args).toEqual(['org-a']);
      calls.length = 0;
      expect((await app.inject({ method: 'GET', url: `/api/equipment/options?customerId=${customerId}&organizationId=org-b`, headers: { cookie } })).json()).toEqual({ equipment: [] });
      expect(calls.find((call) => call.method === 'listOptions')!.args).toEqual(['org-a', customerId]);
    });

    it('is not shadowed by the /:id route', async () => {
      const cookie = await auth.seed(UserRole.OWNER, 'org-a');
      await app.inject({ method: 'GET', url: '/api/customers/options', headers: { cookie } });
      expect(calls.some((call) => call.method === 'findById')).toBe(false);
    });
  });

  describe('permissions are preserved', () => {
    it('lets the TECHNICIAN list customers, equipment, service orders, quotes and warranties, but never payments', async () => {
      const cookie = await auth.seed(UserRole.TECHNICIAN, 'org-a');
      for (const { url } of lists) {
        const response = await app.inject({ method: 'GET', url: `${url}${query({ page: '1', pageSize: '10' })}`, headers: { cookie } });
        expect(response.statusCode, url).toBe(url === '/api/payments' ? 403 : 200);
      }
      expect(calls.some((call) => call.method === 'listPayments')).toBe(false);
    });

    it('denies payments with a valid or invalid query alike (permission comes before validation)', async () => {
      const cookie = await auth.seed(UserRole.TECHNICIAN, 'org-a');
      const valid = await app.inject({ method: 'GET', url: `/api/payments${query({ page: '1' })}`, headers: { cookie } });
      const invalid = await app.inject({ method: 'GET', url: `/api/payments${query({ page: '0' })}`, headers: { cookie } });
      expect([valid.statusCode, invalid.statusCode]).toEqual([403, 403]);
    });

    it('lets OWNER and ADMIN list payments', async () => {
      for (const role of [UserRole.OWNER, UserRole.ADMIN]) {
        const cookie = await auth.seed(role, 'org-a');
        expect((await app.inject({ method: 'GET', url: '/api/payments', headers: { cookie } })).statusCode).toBe(200);
      }
    });
  });
});
