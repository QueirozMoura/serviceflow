import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import type { DashboardData, DashboardRepository } from '../src/modules/dashboard/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
// A matriz faz mais de 100 requisicoes do mesmo IP; o rate limit nao e o objeto destes testes.
process.env.RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
const { createSessionToken, sessionExpiresAt } = await import('../src/modules/auth/session.js');
const { PERMISSIONS, hasPermission, permissionsFor, quoteStatusPermission, serviceOrderStatusPermission } = await import('../src/modules/auth/permissions.js');

class MemoryAuthRepository implements AuthRepository {
  users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord>();
  async createOrganizationWithOwner(): Promise<CreatedAccount> { throw new Error('not used'); }
  findUsersByEmail(email: string): Promise<AuthUserRecord[]> { return Promise.resolve(this.users.filter((user) => user.email === email)); }
  findUserById(id: string): Promise<AuthUserRecord | null> { return Promise.resolve(this.users.find((user) => user.id === id) ?? null); }
  async updateUserName(id: string, organizationId: string, name: string): Promise<AuthUserRecord | null> { const user = this.users.find((candidate) => candidate.id === id && candidate.organizationId === organizationId); if (!user) return null; user.name = name; return user; }
  async createSession(input: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void> { const user = this.users.find((candidate) => candidate.id === input.userId); if (!user) throw new Error('User not found'); this.sessions.set(input.tokenHash, { expiresAt: input.expiresAt, user: { id: user.id, organizationId: user.organizationId, role: user.role } }); }
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> { return Promise.resolve(this.sessions.get(tokenHash) ?? null); }
  async revokeSession(tokenHash: string): Promise<void> { this.sessions.delete(tokenHash); }
  findUserByOAuthAccount(): Promise<AuthUserRecord | null> { return Promise.resolve(null); }
  async linkOAuthAccount(): Promise<void> { return undefined; }
  createOrganizationWithOAuthUser(): Promise<CreatedAccount> { throw new Error('not used'); }

  async seed(role: UserRole, organizationId = 'organization-1') {
    const id = `user-${this.users.length + 1}`;
    const organization = { id: organizationId, name: `Org ${organizationId}`, slug: organizationId };
    this.users.push({ id, organizationId, name: `${role} ${id}`, email: `${id}@example.com`, passwordHash: 'hash', role, organization });
    const { token, tokenHash } = createSessionToken();
    await this.createSession({ tokenHash, userId: id, organizationId, expiresAt: sessionExpiresAt() });
    return { id, organizationId, cookie: `${env.AUTH_COOKIE_NAME}=${token}` };
  }
}

// Repositorio que registra cada acesso a dados. Se uma requisicao negada chegar a ele, o teste falha.
const repositoryCalls: string[] = [];
function recordingRepository<T>(): T {
  return new Proxy({}, { get: (_target, property) => (property === 'then' ? undefined : async () => { repositoryCalls.push(String(property)); return null; }) }) as T;
}

const emptyDashboard = (): DashboardData => ({
  serviceOrders: { total: 1, byStatus: { RECEIVED: 1, WAITING_DIAGNOSIS: 0, WAITING_APPROVAL: 0, APPROVED: 0, IN_PROGRESS: 0, READY: 0, DELIVERED: 0, CANCELLED: 0 } },
  customers: { total: 1 }, equipment: { total: 1 },
  quotes: { byStatus: { PENDING: 1, APPROVED: 0, REJECTED: 0, EXPIRED: 0 }, pendingTotal: '10.00', approvedTotal: '0.00' },
  payments: { byStatus: { PENDING: 0, PAID: 2, FAILED: 0, CANCELLED: 0, REFUNDED: 0 }, paidTotal: '175.75' },
  warranties: { active: 0, expired: 0, cancelled: 0 },
  recentServiceOrders: [],
});

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
// technicianDenied e escrito a mao (independente do mapa de permissoes que esta sendo testado).
type RouteCase = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; technicianDenied: boolean; payload?: object };
const routes: RouteCase[] = [
  { method: 'POST', url: '/api/customers', technicianDenied: false },
  { method: 'GET', url: '/api/customers', technicianDenied: false },
  { method: 'GET', url: `/api/customers/${id}`, technicianDenied: false },
  { method: 'PATCH', url: `/api/customers/${id}`, technicianDenied: false },
  { method: 'DELETE', url: `/api/customers/${id}`, technicianDenied: true },
  { method: 'POST', url: '/api/equipment', technicianDenied: false },
  { method: 'GET', url: '/api/equipment', technicianDenied: false },
  { method: 'GET', url: `/api/equipment/${id}`, technicianDenied: false },
  { method: 'PATCH', url: `/api/equipment/${id}`, technicianDenied: false },
  { method: 'DELETE', url: `/api/equipment/${id}`, technicianDenied: true },
  { method: 'POST', url: '/api/service-orders', technicianDenied: false },
  { method: 'GET', url: '/api/service-orders', technicianDenied: false },
  { method: 'GET', url: `/api/service-orders/${id}`, technicianDenied: false },
  { method: 'PATCH', url: `/api/service-orders/${id}`, technicianDenied: false },
  { method: 'PATCH', url: `/api/service-orders/${id}/status`, technicianDenied: false },
  { method: 'DELETE', url: `/api/service-orders/${id}`, technicianDenied: true },
  // Rotas cujo resultado depende do status de destino enviado no corpo.
  { method: 'PATCH', url: `/api/service-orders/${id}/status`, technicianDenied: true, payload: { status: 'CANCELLED' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/status`, technicianDenied: true, payload: { status: 'APPROVED' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/status`, technicianDenied: false, payload: { status: 'WAITING_DIAGNOSIS' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/status`, technicianDenied: false, payload: { status: 'DELIVERED' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/quote/status`, technicianDenied: true, payload: { status: 'APPROVED' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/quote/status`, technicianDenied: true, payload: { status: 'REJECTED' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/quote/status`, technicianDenied: true, payload: { status: 'EXPIRED' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/warranty/status`, technicianDenied: true, payload: { status: 'EXPIRED' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/warranty/status`, technicianDenied: true, payload: { status: 'CANCELLED' } },
  { method: 'POST', url: `/api/service-orders/${id}/diagnosis`, technicianDenied: false },
  { method: 'GET', url: `/api/service-orders/${id}/diagnosis`, technicianDenied: false },
  { method: 'PATCH', url: `/api/service-orders/${id}/diagnosis`, technicianDenied: false },
  { method: 'DELETE', url: `/api/service-orders/${id}/diagnosis`, technicianDenied: true },
  { method: 'POST', url: `/api/service-orders/${id}/quote`, technicianDenied: false },
  { method: 'GET', url: `/api/service-orders/${id}/quote`, technicianDenied: false },
  { method: 'PATCH', url: `/api/service-orders/${id}/quote`, technicianDenied: false },
  { method: 'PATCH', url: `/api/service-orders/${id}/quote/status`, technicianDenied: false },
  { method: 'DELETE', url: `/api/service-orders/${id}/quote`, technicianDenied: true },
  // Itens mudam o total do orcamento: criar, remover e alterar preco/quantidade sao financeiros (so OWNER/ADMIN).
  { method: 'POST', url: `/api/service-orders/${id}/quote/items`, technicianDenied: true },
  { method: 'PATCH', url: `/api/service-orders/${id}/quote/items/${other}`, technicianDenied: true, payload: { unitPrice: '10.00' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/quote/items/${other}`, technicianDenied: true, payload: { quantity: '2' } },
  { method: 'PATCH', url: `/api/service-orders/${id}/quote/items/${other}`, technicianDenied: false, payload: { description: 'Troca de peca' } },
  { method: 'DELETE', url: `/api/service-orders/${id}/quote/items/${other}`, technicianDenied: true },
  // Valores da OS: so quem tem serviceOrders:value os define (no PATCH, apenas se mudarem; ver testes de integracao).
  { method: 'POST', url: '/api/service-orders', technicianDenied: true, payload: { customerId: id, equipmentId: id, problemDescription: 'Nao liga', finalValue: '10.00' } },
  { method: 'POST', url: '/api/service-orders', technicianDenied: true, payload: { customerId: id, equipmentId: id, problemDescription: 'Nao liga', estimatedValue: '10.00' } },
  { method: 'POST', url: `/api/service-orders/${id}/payments`, technicianDenied: true },
  { method: 'GET', url: `/api/service-orders/${id}/payments`, technicianDenied: true },
  { method: 'GET', url: `/api/service-orders/${id}/payments/${other}`, technicianDenied: true },
  { method: 'PATCH', url: `/api/service-orders/${id}/payments/${other}`, technicianDenied: true },
  { method: 'PATCH', url: `/api/service-orders/${id}/payments/${other}/status`, technicianDenied: true },
  { method: 'DELETE', url: `/api/service-orders/${id}/payments/${other}`, technicianDenied: true },
  { method: 'POST', url: `/api/service-orders/${id}/warranty`, technicianDenied: false },
  { method: 'GET', url: `/api/service-orders/${id}/warranty`, technicianDenied: false },
  { method: 'PATCH', url: `/api/service-orders/${id}/warranty`, technicianDenied: false },
  { method: 'PATCH', url: `/api/service-orders/${id}/warranty/status`, technicianDenied: true },
  { method: 'DELETE', url: `/api/service-orders/${id}/warranty`, technicianDenied: true },
  { method: 'POST', url: `/api/service-orders/${id}/messages`, technicianDenied: false },
  { method: 'GET', url: `/api/service-orders/${id}/messages/history`, technicianDenied: false },
  { method: 'POST', url: `/api/service-orders/${id}/messages/history`, technicianDenied: false, payload: { type: 'SERVICE_RECEIVED', channel: 'WHATSAPP' } },
  { method: 'GET', url: '/api/dashboard', technicianDenied: false },
  // Listagens agregadas: o tecnico le orcamentos e garantias, mas nunca pagamentos.
  { method: 'GET', url: '/api/quotes', technicianDenied: false },
  { method: 'GET', url: '/api/payments', technicianDenied: true },
  { method: 'GET', url: '/api/warranties', technicianDenied: false },
];
const label = (route: RouteCase) => `${route.method} ${route.url.replaceAll(id, ':id').replaceAll(other, ':sub')}${route.payload && 'status' in route.payload ? ` -> ${String(route.payload.status)}` : ''}`;

describe('role-based authorization', () => {
  let app: FastifyInstance;
  let auth: MemoryAuthRepository;
  let dashboard: DashboardRepository;

  async function start() {
    repositoryCalls.length = 0;
    auth = new MemoryAuthRepository();
    dashboard = { getDashboard: async () => emptyDashboard() };
    app = buildApp({
      authRepository: auth, dashboardRepository: dashboard,
      customerRepository: recordingRepository(), equipmentRepository: recordingRepository(), serviceOrderRepository: recordingRepository(),
      diagnosisRepository: recordingRepository(), quoteRepository: recordingRepository(), paymentRepository: recordingRepository(),
      warrantyRepository: recordingRepository(), messageRepository: recordingRepository(), overviewRepository: recordingRepository(),
    });
    await app.ready();
  }
  beforeEach(start);
  afterEach(async () => { await app.close(); });

  const call = (route: Pick<RouteCase, 'method' | 'url' | 'payload'>, cookie?: string, extra: { headers?: Record<string, string>; payload?: object; query?: string } = {}) =>
    app.inject({ method: route.method, url: route.url + (extra.query ?? ''), headers: { ...(cookie ? { cookie } : {}), ...extra.headers }, ...(route.method === 'POST' || route.method === 'PATCH' ? { payload: extra.payload ?? route.payload ?? {} } : {}) });

  describe('permission map', () => {
    it('gives OWNER and ADMIN every permission', () => {
      expect(permissionsFor(UserRole.OWNER)).toEqual([...PERMISSIONS]);
      expect(permissionsFor(UserRole.ADMIN)).toEqual([...PERMISSIONS]);
    });

    it('limits TECHNICIAN to the bench workflow: no deletions and no payments', () => {
      const technician = permissionsFor(UserRole.TECHNICIAN);
      expect(technician.filter((permission) => permission.endsWith(':delete'))).toEqual([]);
      expect(technician.filter((permission) => permission.startsWith('payments:'))).toEqual([]);
      expect(technician).toEqual(expect.arrayContaining(['customers:write', 'equipment:write', 'serviceOrders:write', 'diagnoses:write', 'quotes:write', 'warranties:write', 'messages:generate', 'dashboard:read']));
    });

    it('gives every status decision only to OWNER and ADMIN', () => {
      const decisions = ['serviceOrders:approve', 'serviceOrders:cancel', 'serviceOrders:value', 'quotes:approve', 'quotes:reject', 'quotes:expire', 'quotes:price', 'warranties:status'] as const;
      for (const role of [UserRole.OWNER, UserRole.ADMIN]) for (const permission of decisions) expect(hasPermission(role, permission)).toBe(true);
      for (const permission of decisions) expect(hasPermission(UserRole.TECHNICIAN, permission)).toBe(false);
      expect(permissionsFor(UserRole.TECHNICIAN)).toEqual(expect.arrayContaining(['serviceOrders:write', 'quotes:read', 'quotes:write', 'warranties:read', 'warranties:write']));
    });

    it('maps only the restricted target statuses to a specific permission', () => {
      expect(serviceOrderStatusPermission('CANCELLED')).toBe('serviceOrders:cancel');
      expect(serviceOrderStatusPermission('APPROVED')).toBe('serviceOrders:approve');
      for (const status of ['RECEIVED', 'WAITING_DIAGNOSIS', 'WAITING_APPROVAL', 'IN_PROGRESS', 'READY', 'DELIVERED'] as const) expect(serviceOrderStatusPermission(status)).toBeNull();
      expect(quoteStatusPermission('APPROVED')).toBe('quotes:approve');
      expect(quoteStatusPermission('REJECTED')).toBe('quotes:reject');
      // Todo outro status de orcamento (EXPIRED, PENDING...) tambem e decisao: nenhum valor escapa da verificacao.
      expect(quoteStatusPermission('EXPIRED')).toBe('quotes:expire');
      expect(quoteStatusPermission('PENDING')).toBe('quotes:expire');
    });

    it('denies everything to an unknown role instead of assuming administrator', () => {
      const unknown = 'AUDITOR' as unknown as UserRole;
      expect(permissionsFor(unknown)).toEqual([]);
      expect(hasPermission(unknown, 'customers:read')).toBe(false);
    });
  });

  describe('authentication (401)', () => {
    it.each(routes.map((route) => [label(route), route] as const))('%s requires a session', async (_name, route) => {
      const anonymous = await call(route);
      const forged = await call(route, `${env.AUTH_COOKIE_NAME}=forged-token`);
      expect([anonymous.statusCode, forged.statusCode]).toEqual([401, 401]);
      expect(repositoryCalls).toEqual([]);
    });
  });

  describe('permission matrix', () => {
    it.each(routes.map((route) => [label(route), route] as const))('%s', async (_name, route) => {
      const owner = await auth.seed(UserRole.OWNER);
      const admin = await auth.seed(UserRole.ADMIN);
      const technician = await auth.seed(UserRole.TECHNICIAN);

      for (const actor of [owner, admin]) {
        const response = await call(route, actor.cookie);
        expect([401, 403]).not.toContain(response.statusCode);
      }

      repositoryCalls.length = 0;
      const response = await call(route, technician.cookie);
      if (route.technicianDenied) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ statusCode: 403, error: 'Forbidden', message: 'You do not have permission to perform this action' });
        // A negacao acontece antes de qualquer acesso a dados.
        expect(repositoryCalls).toEqual([]);
      } else {
        expect([401, 403]).not.toContain(response.statusCode);
      }
    });
  });

  describe('forged identity and privilege escalation', () => {
    it('ignores role, user and organization sent by a TECHNICIAN in body, query or headers', async () => {
      const technician = await auth.seed(UserRole.TECHNICIAN, 'organization-1');
      const owner = await auth.seed(UserRole.OWNER, 'organization-2');
      const forgedHeaders = { 'x-user-role': 'OWNER', 'x-role': 'ADMIN', 'x-user-id': owner.id, 'x-organization-id': owner.organizationId, authorization: 'Bearer OWNER' };
      const forgedPayload = { role: 'OWNER', userId: owner.id, organizationId: owner.organizationId, user: { role: 'OWNER' } };
      // Rotas com corpo fixo (status) so recebem a falsificacao por cabecalho e URL: campos extras no corpo dariam 400 antes do 403.
      const bodyFor = (route: RouteCase) => (route.payload ? route.payload : forgedPayload);
      const forgedQuery = `?role=OWNER&userId=${owner.id}&organizationId=${owner.organizationId}`;

      for (const route of routes.filter((candidate) => candidate.technicianDenied)) {
        const response = await call(route, technician.cookie, { headers: forgedHeaders, payload: bodyFor(route), query: forgedQuery });
        expect(response.statusCode, label(route)).toBe(403);
      }
      expect(repositoryCalls).toEqual([]);
    });

    it('does not let a user change their own role or organization through the profile route', async () => {
      const technician = await auth.seed(UserRole.TECHNICIAN);
      for (const payload of [{ name: 'Valid', role: 'OWNER' }, { name: 'Valid', permissions: ['payments:write'] }, { name: 'Valid', organizationId: 'organization-9' }]) {
        const response = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie: technician.cookie }, payload });
        expect(response.statusCode).toBe(400);
      }
      const stored = auth.users.find((user) => user.id === technician.id)!;
      expect(stored.role).toBe(UserRole.TECHNICIAN);
      expect(stored.organizationId).toBe('organization-1');
      const payments = await call(routes.find((route) => route.url.endsWith('/payments') && route.method === 'GET')!, technician.cookie);
      expect(payments.statusCode).toBe(403);
    });

    it('lets every role keep using its own profile', async () => {
      for (const role of [UserRole.OWNER, UserRole.ADMIN, UserRole.TECHNICIAN]) {
        const actor = await auth.seed(role);
        const read = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: actor.cookie } });
        const update = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie: actor.cookie }, payload: { name: `Renamed ${role}` } });
        expect([read.statusCode, update.statusCode]).toEqual([200, 200]);
        expect(update.json().user.name).toBe(`Renamed ${role}`);
      }
    });
  });

  describe('effective permissions exposed to the client', () => {
    it('returns the permissions of the authenticated role on GET /me', async () => {
      const technician = await auth.seed(UserRole.TECHNICIAN);
      const owner = await auth.seed(UserRole.OWNER);
      const technicianMe = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: technician.cookie } })).json().user;
      const ownerMe = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: owner.cookie } })).json().user;

      expect(technicianMe.role).toBe('TECHNICIAN');
      expect(technicianMe.permissions).toEqual(permissionsFor(UserRole.TECHNICIAN));
      expect(technicianMe.permissions).not.toContain('payments:read');
      expect(ownerMe.permissions).toEqual([...PERMISSIONS]);
    });
  });

  describe('dashboard', () => {
    it('withholds payment totals from roles without payments:read', async () => {
      const owner = await auth.seed(UserRole.OWNER);
      const admin = await auth.seed(UserRole.ADMIN);
      const technician = await auth.seed(UserRole.TECHNICIAN);
      const get = (cookie: string) => app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

      const technicianBody = (await get(technician.cookie)).json();
      expect(technicianBody.payments).toBeNull();
      expect(JSON.stringify(technicianBody)).not.toContain('175.75');
      expect(technicianBody.serviceOrders.total).toBe(1);
      expect((await get(owner.cookie)).json().payments.paidTotal).toBe('175.75');
      expect((await get(admin.cookie)).json().payments.paidTotal).toBe('175.75');
    });
  });

  describe('status decisions that depend on the request body', () => {
    const statusRoute = (kind: 'order' | 'quote' | 'warranty', status: string): RouteCase => ({ method: 'PATCH', url: `/api/service-orders/${id}/${kind === 'order' ? 'status' : kind === 'quote' ? 'quote/status' : 'warranty/status'}`, technicianDenied: false, payload: { status } });

    it.each([['order', 'CANCELLED'], ['order', 'APPROVED'], ['quote', 'APPROVED'], ['quote', 'REJECTED'], ['quote', 'EXPIRED'], ['quote', 'PENDING'], ['warranty', 'EXPIRED'], ['warranty', 'CANCELLED'], ['warranty', 'ACTIVE']] as const)('denies the TECHNICIAN %s -> %s before touching data, even for ids that do not exist', async (kind, status) => {
      const technician = await auth.seed(UserRole.TECHNICIAN);
      const existing = await call(statusRoute(kind, status), technician.cookie);
      const missing = await call({ ...statusRoute(kind, status), url: statusRoute(kind, status).url.replace(id, other) }, technician.cookie);
      expect([existing.statusCode, missing.statusCode]).toEqual([403, 403]);
      expect(existing.json()).toEqual(missing.json());
      expect(repositoryCalls).toEqual([]);
    });

    it.each([['order', 'RECEIVED'], ['order', 'WAITING_DIAGNOSIS'], ['order', 'WAITING_APPROVAL'], ['order', 'IN_PROGRESS'], ['order', 'READY'], ['order', 'DELIVERED']] as const)('lets the TECHNICIAN reach the %s -> %s handler (business validation still applies there)', async (kind, status) => {
      const technician = await auth.seed(UserRole.TECHNICIAN);
      const response = await call(statusRoute(kind, status), technician.cookie);
      expect([401, 403]).not.toContain(response.statusCode);
      expect(repositoryCalls.length).toBeGreaterThan(0);
    });

    it.each([['order', 'CANCELLED'], ['order', 'APPROVED'], ['order', 'DELIVERED'], ['quote', 'APPROVED'], ['quote', 'REJECTED'], ['quote', 'EXPIRED'], ['warranty', 'EXPIRED'], ['warranty', 'CANCELLED']] as const)('lets OWNER and ADMIN reach %s -> %s', async (kind, status) => {
      for (const role of [UserRole.OWNER, UserRole.ADMIN]) {
        const actor = await auth.seed(role);
        const response = await call(statusRoute(kind, status), actor.cookie);
        expect([401, 403]).not.toContain(response.statusCode);
      }
    });

    it('validates the body before the status permission (malformed status is a 400, never a bypass)', async () => {
      const technician = await auth.seed(UserRole.TECHNICIAN);
      for (const payload of [{}, { status: 'NOT_A_STATUS' }, { status: 'CANCELLED', role: 'OWNER' }, { status: ['CANCELLED'] }]) {
        const order = await call({ method: 'PATCH', url: `/api/service-orders/${id}/status`, payload }, technician.cookie);
        const quote = await call({ method: 'PATCH', url: `/api/service-orders/${id}/quote/status`, payload }, technician.cookie);
        expect([order.statusCode, quote.statusCode]).toEqual([400, 400]);
      }
      expect(repositoryCalls).toEqual([]);
    });

    it('does not let a status change slip in through the generic update routes', async () => {
      const technician = await auth.seed(UserRole.TECHNICIAN);
      const order = await call({ method: 'PATCH', url: `/api/service-orders/${id}`, payload: { status: 'CANCELLED' } }, technician.cookie);
      const quote = await call({ method: 'PATCH', url: `/api/service-orders/${id}/quote`, payload: { status: 'APPROVED' } }, technician.cookie);
      expect([order.statusCode, quote.statusCode]).toEqual([400, 400]);
      expect(repositoryCalls).toEqual([]);
    });
  });
});
