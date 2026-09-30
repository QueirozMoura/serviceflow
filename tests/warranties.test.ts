import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServiceOrderStatus, UserRole, WarrantyStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import { effectiveWarrantyStatus, WarrantyAlreadyExistsError, WarrantyImmutableError, type WarrantyRecord, type WarrantyRepository } from '../src/modules/warranties/repository.js';
import type { CreateWarrantyInput, UpdateWarrantyInput } from '../src/modules/warranties/schemas.js';

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

class MemoryWarrantyRepository implements WarrantyRepository {
  private warranties: WarrantyRecord[] = [];
  private serviceOrders = new Map<string, { organizationId: string; status: ServiceOrderStatus }>();
  private sequence = 0;
  seedServiceOrder(id: string, organizationId: string, status: ServiceOrderStatus): void { this.serviceOrders.set(id, { organizationId, status }); }
  serviceOrderStatus(organizationId: string, serviceOrderId: string): Promise<ServiceOrderStatus | null> { const order = this.serviceOrders.get(serviceOrderId); return Promise.resolve(order?.organizationId === organizationId ? order.status : null); }
  findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<WarrantyRecord | null> { const warranty = this.warranties.find((candidate) => candidate.serviceOrderId === serviceOrderId && this.serviceOrders.get(serviceOrderId)?.organizationId === organizationId); return Promise.resolve(warranty ? { ...warranty, status: effectiveWarrantyStatus(warranty) } : null); }
  async create(organizationId: string, serviceOrderId: string, input: CreateWarrantyInput): Promise<WarrantyRecord> { if (await this.findByServiceOrder(organizationId, serviceOrderId)) throw new WarrantyAlreadyExistsError(); const warranty: WarrantyRecord = { id: `warranty-${++this.sequence}`, organizationId, serviceOrderId, startDate: input.startDate, endDate: input.endDate, description: input.description, status: WarrantyStatus.ACTIVE, createdAt: new Date(), updatedAt: new Date(), serviceOrder: { id: serviceOrderId, orderNumber: 'OS-20260930-00000001', status: this.serviceOrders.get(serviceOrderId)?.status ?? ServiceOrderStatus.DELIVERED } }; this.warranties.push(warranty); return warranty; }
  async update(organizationId: string, serviceOrderId: string, input: UpdateWarrantyInput): Promise<WarrantyRecord | null> { const warranty = await this.findByServiceOrder(organizationId, serviceOrderId); if (!warranty) return null; if (warranty.status !== WarrantyStatus.ACTIVE || warranty.endDate <= new Date()) throw new WarrantyImmutableError(); Object.assign(warranty, input, { updatedAt: new Date() }); return warranty; }
  async updateStatus(organizationId: string, serviceOrderId: string, status: WarrantyStatus): Promise<WarrantyRecord | null> { const warranty = await this.findByServiceOrder(organizationId, serviceOrderId); if (!warranty) return null; warranty.status = status; return warranty; }
  async delete(organizationId: string, serviceOrderId: string): Promise<boolean> { const warranty = await this.findByServiceOrder(organizationId, serviceOrderId); if (!warranty) return false; if (warranty.status !== WarrantyStatus.ACTIVE || warranty.endDate <= new Date()) throw new WarrantyImmutableError(); this.warranties = this.warranties.filter((candidate) => candidate.id !== warranty.id); return true; }
}

describe('warranty routes', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let warrantyRepository: MemoryWarrantyRepository;
  let sequence = 0;
  beforeEach(async () => { authRepository = new MemoryAuthRepository(); warrantyRepository = new MemoryWarrantyRepository(); app = buildApp({ authRepository, warrantyRepository }); await app.ready(); });
  afterEach(async () => { await app.close(); });

  async function loginForOrganization(name: string) { const id = ++sequence; const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: name, name: `${name} Owner`, email: `owner-${id}@example.com`, password: 'StrongPass1' } }); const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' } }); const setCookie = login.headers['set-cookie']; return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0], organizationId: registration.json().user.organizationId as string }; }

  it('creates, reads, updates, and deletes a warranty for a delivered order', async () => {
    const owner = await loginForOrganization('Warranty One'); const orderId = '11111111-1111-4111-8111-111111111111'; warrantyRepository.seedServiceOrder(orderId, owner.organizationId, ServiceOrderStatus.DELIVERED);
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${orderId}/warranty`, headers: { cookie: owner.cookie }, payload: { startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-11-01T00:00:00.000Z', description: 'Garantia de 30 dias' } });
    const viewed = await app.inject({ method: 'GET', url: `/api/service-orders/${orderId}/warranty`, headers: { cookie: owner.cookie } }); const updated = await app.inject({ method: 'PATCH', url: `/api/service-orders/${orderId}/warranty`, headers: { cookie: owner.cookie }, payload: { description: 'Garantia atualizada' } }); const deleted = await app.inject({ method: 'DELETE', url: `/api/service-orders/${orderId}/warranty`, headers: { cookie: owner.cookie } });
    expect(created.statusCode).toBe(201); expect(created.json().warranty.status).toBe('ACTIVE'); expect(viewed.statusCode).toBe(200); expect(updated.json().warranty.description).toBe('Garantia atualizada'); expect(deleted.statusCode).toBe(204);
  });

  it('requires DELIVERED status and rejects duplicates and cross-tenant access', async () => {
    const first = await loginForOrganization('Warranty Two'); const second = await loginForOrganization('Warranty Three'); const delivered = '22222222-2222-4222-8222-222222222222'; const inProgress = '33333333-3333-4333-8333-333333333333'; warrantyRepository.seedServiceOrder(delivered, first.organizationId, ServiceOrderStatus.DELIVERED); warrantyRepository.seedServiceOrder(inProgress, first.organizationId, ServiceOrderStatus.IN_PROGRESS);
    const early = await app.inject({ method: 'POST', url: `/api/service-orders/${inProgress}/warranty`, headers: { cookie: first.cookie }, payload: { startDate: '2026-10-01', endDate: '2026-11-01', description: 'Prematura' } }); const other = await app.inject({ method: 'POST', url: `/api/service-orders/${delivered}/warranty`, headers: { cookie: second.cookie }, payload: { startDate: '2026-10-01', endDate: '2026-11-01', description: 'Outro tenant' } }); const created = await app.inject({ method: 'POST', url: `/api/service-orders/${delivered}/warranty`, headers: { cookie: first.cookie }, payload: { startDate: '2026-10-01', endDate: '2026-11-01', description: 'Valida' } }); const duplicate = await app.inject({ method: 'POST', url: `/api/service-orders/${delivered}/warranty`, headers: { cookie: first.cookie }, payload: { startDate: '2026-10-01', endDate: '2026-11-01', description: 'Duplicada' } });
    expect(early.statusCode).toBe(409); expect(other.statusCode).toBe(404); expect(created.statusCode).toBe(201); expect(duplicate.statusCode).toBe(409);
  });

  it('isolates warranty access through the service order and blocks internal fields', async () => {
    const first = await loginForOrganization('Warranty Four'); const second = await loginForOrganization('Warranty Five'); const firstOrder = '44444444-4444-4444-8444-444444444444'; const otherOrder = '55555555-5555-4555-8555-555555555555'; warrantyRepository.seedServiceOrder(firstOrder, first.organizationId, ServiceOrderStatus.DELIVERED); warrantyRepository.seedServiceOrder(otherOrder, second.organizationId, ServiceOrderStatus.DELIVERED); await app.inject({ method: 'POST', url: `/api/service-orders/${firstOrder}/warranty`, headers: { cookie: first.cookie }, payload: { startDate: '2026-10-01', endDate: '2026-11-01', description: 'Privada' } });
    const crossRead = await app.inject({ method: 'GET', url: `/api/service-orders/${firstOrder}/warranty`, headers: { cookie: second.cookie } }); const wrongOrder = await app.inject({ method: 'GET', url: `/api/service-orders/${otherOrder}/warranty`, headers: { cookie: second.cookie } }); const internal = await app.inject({ method: 'POST', url: `/api/service-orders/${otherOrder}/warranty`, headers: { cookie: second.cookie }, payload: { startDate: '2026-10-01', endDate: '2026-11-01', description: 'Ok', organizationId: 'other', serviceOrderId: firstOrder } });
    expect(crossRead.statusCode).toBe(404); expect(wrongOrder.statusCode).toBe(404); expect(internal.statusCode).toBe(400);
  });

  it('validates dates, handles expiration, and controls status transitions', async () => {
    const owner = await loginForOrganization('Warranty Six'); const orderId = '66666666-6666-4666-8666-666666666666'; warrantyRepository.seedServiceOrder(orderId, owner.organizationId, ServiceOrderStatus.DELIVERED); const invalid = await app.inject({ method: 'POST', url: `/api/service-orders/${orderId}/warranty`, headers: { cookie: owner.cookie }, payload: { startDate: '2026-11-01', endDate: '2026-10-01', description: 'Datas invalidas' } }); const created = await app.inject({ method: 'POST', url: `/api/service-orders/${orderId}/warranty`, headers: { cookie: owner.cookie }, payload: { startDate: '2020-01-01', endDate: '2020-02-01', description: 'Expirada' } }); const viewed = await app.inject({ method: 'GET', url: `/api/service-orders/${orderId}/warranty`, headers: { cookie: owner.cookie } });
    expect(invalid.statusCode).toBe(400); expect(created.statusCode).toBe(201); expect(viewed.json().warranty.status).toBe('EXPIRED');
  });

  it('requires authentication and prevents status reopening', async () => {
    const unauthorized = await Promise.all([app.inject({ method: 'POST', url: '/api/service-orders/order-1/warranty', payload: {} }), app.inject({ method: 'GET', url: '/api/service-orders/order-1/warranty' }), app.inject({ method: 'PATCH', url: '/api/service-orders/order-1/warranty', payload: {} }), app.inject({ method: 'DELETE', url: '/api/service-orders/order-1/warranty' }), app.inject({ method: 'PATCH', url: '/api/service-orders/order-1/warranty/status', payload: { status: 'CANCELLED' } })]);
    const owner = await loginForOrganization('Warranty Seven'); const orderId = '77777777-7777-4777-8777-777777777777'; warrantyRepository.seedServiceOrder(orderId, owner.organizationId, ServiceOrderStatus.DELIVERED); await app.inject({ method: 'POST', url: `/api/service-orders/${orderId}/warranty`, headers: { cookie: owner.cookie }, payload: { startDate: '2026-10-01', endDate: '2026-11-01', description: 'Status' } }); const cancelled = await app.inject({ method: 'PATCH', url: `/api/service-orders/${orderId}/warranty/status`, headers: { cookie: owner.cookie }, payload: { status: 'CANCELLED' } }); const reopened = await app.inject({ method: 'PATCH', url: `/api/service-orders/${orderId}/warranty/status`, headers: { cookie: owner.cookie }, payload: { status: 'ACTIVE' } });
    expect(unauthorized.every((response) => response.statusCode === 401)).toBe(true); expect(cancelled.statusCode).toBe(200); expect(reopened.statusCode).toBe(409);
  });
});