import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PaymentStatus, QuoteStatus, ServiceOrderStatus, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import type { DashboardData, DashboardRepository } from '../src/modules/dashboard/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { buildApp } = await import('../src/app.js');

class MemoryAuthRepository implements AuthRepository {
  private users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord & { revokedAt?: Date }>();
  private sequence = 0;
  async createOrganizationWithOwner(input: { organizationName: string; slug: string; name: string; email: string; passwordHash: string }): Promise<CreatedAccount> { const id = String(++this.sequence); const organization = { id: `organization-${id}`, name: input.organizationName, slug: input.slug }; const user: AuthUserRecord = { id: `user-${id}`, organizationId: organization.id, name: input.name, email: input.email, passwordHash: input.passwordHash, role: UserRole.OWNER, organization }; this.users.push(user); return { user, organization }; }
  findUsersByEmail(email: string): Promise<AuthUserRecord[]> { return Promise.resolve(this.users.filter((user) => user.email === email)); }
  findUserById(id: string): Promise<AuthUserRecord | null> { return Promise.resolve(this.users.find((user) => user.id === id) ?? null); }
  async createSession(input: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void> { const user = this.users.find((candidate) => candidate.id === input.userId); if (!user) throw new Error('User not found'); this.sessions.set(input.tokenHash, { expiresAt: input.expiresAt, user: { id: user.id, organizationId: user.organizationId, role: user.role } }); }
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> { const session = this.sessions.get(tokenHash); return Promise.resolve(session && !session.revokedAt ? session : null); }
  async revokeSession(tokenHash: string): Promise<void> { const session = this.sessions.get(tokenHash); if (session) session.revokedAt = new Date(); }
}

function snapshot(organizationId: string, orderCount: number): DashboardData {
  const recentServiceOrders = Array.from({ length: orderCount }, (_, index) => ({
    id: `${organizationId}-order-${index}`,
    orderNumber: `OS-${String(index).padStart(4, '0')}`,
    status: index === 0 ? ServiceOrderStatus.IN_PROGRESS : ServiceOrderStatus.RECEIVED,
    problemDescription: `Problem ${index}`,
    customer: { id: `${organizationId}-customer-${index}`, name: `Customer ${index}` },
    equipment: { id: `${organizationId}-equipment-${index}`, type: 'Notebook', brand: 'Brand', model: 'Model' },
    createdAt: new Date(2026, 8, 30, 12, 0, orderCount - index),
    updatedAt: new Date(2026, 8, 30, 12, 0, orderCount - index),
  }));
  return {
    serviceOrders: { total: 4, byStatus: { RECEIVED: 1, WAITING_DIAGNOSIS: 0, WAITING_APPROVAL: 0, APPROVED: 0, IN_PROGRESS: 1, READY: 0, DELIVERED: 2, CANCELLED: 0 } },
    customers: { total: 3 },
    equipment: { total: 4 },
    quotes: { byStatus: { PENDING: 1, APPROVED: 2, REJECTED: 0, EXPIRED: 0 }, pendingTotal: '100.00', approvedTotal: '250.50' },
    payments: { byStatus: { PENDING: 1, PAID: 2, FAILED: 1, CANCELLED: 0, REFUNDED: 1 }, paidTotal: '175.75' },
    warranties: { active: 1, expired: 2, cancelled: 1 },
    recentServiceOrders,
  };
}

class MemoryDashboardRepository implements DashboardRepository {
  readonly data = new Map<string, DashboardData>();
  lastOrganizationId: string | null = null;
  async getDashboard(organizationId: string): Promise<DashboardData> { this.lastOrganizationId = organizationId; return this.data.get(organizationId) ?? snapshot(organizationId, 0); }
}

describe('dashboard route', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let dashboardRepository: MemoryDashboardRepository;
  let sequence = 0;

  beforeEach(async () => { authRepository = new MemoryAuthRepository(); dashboardRepository = new MemoryDashboardRepository(); app = buildApp({ authRepository, dashboardRepository }); await app.ready(); });
  afterEach(async () => { await app.close(); });

  async function login(name: string) {
    const id = ++sequence;
    const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: name, name: `${name} Owner`, email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const setCookie = response.headers['set-cookie'];
    return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0], organizationId: registration.json().user.organizationId as string };
  }

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(response.statusCode).toBe(401);
  });

  it('returns all tenant metrics without accepting a client organizationId', async () => {
    const first = await login('Dashboard One');
    const second = await login('Dashboard Two');
    dashboardRepository.data.set(first.organizationId, snapshot(first.organizationId, 12));
    dashboardRepository.data.set(second.organizationId, { ...snapshot(second.organizationId, 1), customers: { total: 1 }, equipment: { total: 1 } });

    const response = await app.inject({ method: 'GET', url: `/api/dashboard?organizationId=${second.organizationId}`, headers: { cookie: first.cookie } });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(dashboardRepository.lastOrganizationId).toBe(first.organizationId);
    expect(body.serviceOrders.total).toBe(4);
    expect(body.serviceOrders.byStatus[ServiceOrderStatus.DELIVERED]).toBe(2);
    expect(body.customers.total).toBe(3);
    expect(body.equipment.total).toBe(4);
    expect(body.quotes.byStatus[QuoteStatus.APPROVED]).toBe(2);
    expect(body.quotes.pendingTotal).toBe('100.00');
    expect(body.quotes.approvedTotal).toBe('250.50');
    expect(body.payments.byStatus[PaymentStatus.PAID]).toBe(2);
    expect(body.payments.paidTotal).toBe('175.75');
    expect(body.warranties).toEqual({ active: 1, expired: 2, cancelled: 1 });
  });

  it('returns at most ten recent orders in newest-first order for each organization', async () => {
    const first = await login('Dashboard Three');
    const second = await login('Dashboard Four');
    dashboardRepository.data.set(first.organizationId, snapshot(first.organizationId, 10));
    dashboardRepository.data.set(second.organizationId, snapshot(second.organizationId, 2));

    const firstResponse = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: first.cookie } });
    const secondResponse = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: second.cookie } });
    const firstOrders = firstResponse.json().recentServiceOrders;
    const secondOrders = secondResponse.json().recentServiceOrders;

    expect(firstOrders).toHaveLength(10);
    expect(firstOrders[0].createdAt >= firstOrders[1].createdAt).toBe(true);
    expect(firstOrders.every((order: { id: string }) => order.id.startsWith(first.organizationId))).toBe(true);
    expect(secondOrders).toHaveLength(2);
    expect(secondOrders.every((order: { id: string }) => order.id.startsWith(second.organizationId))).toBe(true);
  });
});