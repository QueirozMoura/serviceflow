import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import { PaymentImmutableError, type PaymentRecord, type PaymentRepository } from '../src/modules/payments/repository.js';
import type { CreatePaymentInput, UpdatePaymentInput } from '../src/modules/payments/schemas.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { buildApp } = await import('../src/app.js');

class MemoryAuthRepository implements AuthRepository {
  private users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord & { revokedAt?: Date }>();
  private sequence = 0;

  async createOrganizationWithOwner(input: { organizationName: string; slug: string; name: string; email: string; passwordHash: string }): Promise<CreatedAccount> {
    const id = String(++this.sequence);
    const organization = { id: `organization-${id}`, name: input.organizationName, slug: input.slug };
    const user: AuthUserRecord = { id: `user-${id}`, organizationId: organization.id, name: input.name, email: input.email, passwordHash: input.passwordHash, role: UserRole.OWNER, organization };
    this.users.push(user);
    return { user, organization };
  }
  findUsersByEmail(email: string): Promise<AuthUserRecord[]> { return Promise.resolve(this.users.filter((user) => user.email === email)); }
  findUserById(id: string): Promise<AuthUserRecord | null> { return Promise.resolve(this.users.find((user) => user.id === id) ?? null); }
  async createSession(input: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void> {
    const user = this.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error('User not found');
    this.sessions.set(input.tokenHash, { expiresAt: input.expiresAt, user: { id: user.id, organizationId: user.organizationId, role: user.role } });
  }
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> { const session = this.sessions.get(tokenHash); return Promise.resolve(session && !session.revokedAt ? session : null); }
  async revokeSession(tokenHash: string): Promise<void> { const session = this.sessions.get(tokenHash); if (session) session.revokedAt = new Date(); }
}

class MemoryPaymentRepository implements PaymentRepository {
  private payments: PaymentRecord[] = [];
  private serviceOrders = new Map<string, string>();
  private sequence = 0;

  seedServiceOrder(serviceOrderId: string, organizationId: string): void { this.serviceOrders.set(serviceOrderId, organizationId); }
  serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean> { return Promise.resolve(this.serviceOrders.get(serviceOrderId) === organizationId); }
  list(organizationId: string, serviceOrderId: string, status?: PaymentStatus): Promise<PaymentRecord[]> { return Promise.resolve(this.payments.filter((payment) => payment.organizationId === organizationId && payment.serviceOrderId === serviceOrderId && (!status || payment.status === status))); }
  findById(organizationId: string, serviceOrderId: string, paymentId: string): Promise<PaymentRecord | null> { return Promise.resolve(this.payments.find((payment) => payment.organizationId === organizationId && payment.serviceOrderId === serviceOrderId && payment.id === paymentId) ?? null); }
  async create(organizationId: string, serviceOrderId: string, input: CreatePaymentInput): Promise<PaymentRecord> { const now = new Date(); const payment: PaymentRecord = { id: `payment-${++this.sequence}`, organizationId, serviceOrderId, amount: new Prisma.Decimal(input.amount), status: PaymentStatus.PENDING, method: input.method, createdAt: now, updatedAt: now, serviceOrder: { id: serviceOrderId, orderNumber: 'OS-20260930-00000001', status: 'RECEIVED' } }; this.payments.push(payment); return payment; }
  async update(organizationId: string, serviceOrderId: string, paymentId: string, input: UpdatePaymentInput): Promise<PaymentRecord | null> { const payment = await this.findById(organizationId, serviceOrderId, paymentId); if (!payment) return null; if (payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.REFUNDED) throw new PaymentImmutableError(); Object.assign(payment, input, input.amount === undefined ? {} : { amount: new Prisma.Decimal(input.amount) }); return payment; }
  async updateStatus(organizationId: string, serviceOrderId: string, paymentId: string, status: PaymentStatus): Promise<PaymentRecord | null> { const payment = await this.findById(organizationId, serviceOrderId, paymentId); if (!payment) return null; payment.status = status; return payment; }
  async delete(organizationId: string, serviceOrderId: string, paymentId: string): Promise<boolean> { const payment = await this.findById(organizationId, serviceOrderId, paymentId); if (!payment) return false; if (payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.REFUNDED) throw new PaymentImmutableError(); this.payments = this.payments.filter((candidate) => candidate.id !== payment.id); return true; }
}

describe('payment routes', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let paymentRepository: MemoryPaymentRepository;
  let sequence = 0;

  beforeEach(async () => { authRepository = new MemoryAuthRepository(); paymentRepository = new MemoryPaymentRepository(); app = buildApp({ authRepository, paymentRepository }); await app.ready(); });
  afterEach(async () => { await app.close(); });

  async function loginForOrganization(name: string) {
    const id = ++sequence;
    const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: name, name: `${name} Owner`, email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const setCookie = login.headers['set-cookie'];
    return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0], organizationId: registration.json().user.organizationId as string };
  }

  it('creates, lists, reads, updates, and deletes a pending payment', async () => {
    const owner = await loginForOrganization('Payments One'); const serviceOrderId = '11111111-1111-4111-8111-111111111111'; paymentRepository.seedServiceOrder(serviceOrderId, owner.organizationId);
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/payments`, headers: { cookie: owner.cookie }, payload: { amount: '125.50', method: 'PIX' } });
    const id = created.json().payment.id;
    const list = await app.inject({ method: 'GET', url: `/api/service-orders/${serviceOrderId}/payments?status=PENDING`, headers: { cookie: owner.cookie } });
    const viewed = await app.inject({ method: 'GET', url: `/api/service-orders/${serviceOrderId}/payments/${id}`, headers: { cookie: owner.cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/payments/${id}`, headers: { cookie: owner.cookie }, payload: { amount: '130.75', method: 'CASH' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/service-orders/${serviceOrderId}/payments/${id}`, headers: { cookie: owner.cookie } });
    expect(created.statusCode).toBe(201); expect(created.json().payment.status).toBe('PENDING'); expect(created.json().payment.amount).toBe('125.5'); expect(list.json().payments).toHaveLength(1); expect(viewed.statusCode).toBe(200); expect(updated.json().payment.method).toBe('CASH'); expect(deleted.statusCode).toBe(204);
  });

  it('isolates payments by organization and service order', async () => {
    const first = await loginForOrganization('Payments Two'); const second = await loginForOrganization('Payments Three'); const firstOrder = '22222222-2222-4222-8222-222222222222'; const otherOrder = '33333333-3333-4333-8333-333333333333'; paymentRepository.seedServiceOrder(firstOrder, first.organizationId); paymentRepository.seedServiceOrder(otherOrder, second.organizationId);
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${firstOrder}/payments`, headers: { cookie: first.cookie }, payload: { amount: '10', method: 'CARD' } }); const id = created.json().payment.id;
    const crossCreate = await app.inject({ method: 'POST', url: `/api/service-orders/${firstOrder}/payments`, headers: { cookie: second.cookie }, payload: { amount: '10', method: 'CARD' } });
    const crossList = await app.inject({ method: 'GET', url: `/api/service-orders/${firstOrder}/payments`, headers: { cookie: second.cookie } }); const wrongOrder = await app.inject({ method: 'GET', url: `/api/service-orders/${otherOrder}/payments/${id}`, headers: { cookie: second.cookie } }); const crossRead = await app.inject({ method: 'GET', url: `/api/service-orders/${firstOrder}/payments/${id}`, headers: { cookie: second.cookie } });
    expect(crossCreate.statusCode).toBe(404); expect(crossList.statusCode).toBe(404); expect(wrongOrder.statusCode).toBe(404); expect(crossRead.statusCode).toBe(404);
  });

  it('enforces payment status transitions and immutability', async () => {
    const owner = await loginForOrganization('Payments Four'); const serviceOrderId = '44444444-4444-4444-8444-444444444444'; paymentRepository.seedServiceOrder(serviceOrderId, owner.organizationId); const created = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/payments`, headers: { cookie: owner.cookie }, payload: { amount: '50', method: 'TRANSFER' } }); const id = created.json().payment.id;
    const paid = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/payments/${id}/status`, headers: { cookie: owner.cookie }, payload: { status: 'PAID' } }); const invalid = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/payments/${id}/status`, headers: { cookie: owner.cookie }, payload: { status: 'PENDING' } }); const generic = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/payments/${id}`, headers: { cookie: owner.cookie }, payload: { status: 'FAILED' } }); const update = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/payments/${id}`, headers: { cookie: owner.cookie }, payload: { amount: '60' } }); const deleted = await app.inject({ method: 'DELETE', url: `/api/service-orders/${serviceOrderId}/payments/${id}`, headers: { cookie: owner.cookie } });
    const refunded = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/payments/${id}/status`, headers: { cookie: owner.cookie }, payload: { status: 'REFUNDED' } }); const refundedAgain = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/payments/${id}/status`, headers: { cookie: owner.cookie }, payload: { status: 'PAID' } });
    expect(paid.statusCode).toBe(200); expect(invalid.statusCode).toBe(409); expect(generic.statusCode).toBe(400); expect(update.statusCode).toBe(409); expect(deleted.statusCode).toBe(409); expect(refunded.statusCode).toBe(200); expect(refundedAgain.statusCode).toBe(409);
  });

  it('requires authentication and validates amounts, methods, and internal fields', async () => {
    const unauthorized = await Promise.all([app.inject({ method: 'POST', url: '/api/service-orders/order-1/payments', payload: {} }), app.inject({ method: 'GET', url: '/api/service-orders/order-1/payments' }), app.inject({ method: 'GET', url: '/api/service-orders/order-1/payments/payment-1' }), app.inject({ method: 'PATCH', url: '/api/service-orders/order-1/payments/payment-1', payload: {} }), app.inject({ method: 'DELETE', url: '/api/service-orders/order-1/payments/payment-1' })]);
    const owner = await loginForOrganization('Payments Five'); const serviceOrderId = '55555555-5555-4555-8555-555555555555'; paymentRepository.seedServiceOrder(serviceOrderId, owner.organizationId);
    const zero = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/payments`, headers: { cookie: owner.cookie }, payload: { amount: '0', method: 'PIX' } }); const negative = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/payments`, headers: { cookie: owner.cookie }, payload: { amount: '-1', method: 'PIX' } }); const invalid = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/payments`, headers: { cookie: owner.cookie }, payload: { amount: 'abc', method: 'INVALID' } }); const internal = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/payments`, headers: { cookie: owner.cookie }, payload: { amount: '1', method: 'PIX', organizationId: 'other', serviceOrderId: 'other' } });
    expect(unauthorized.every((response) => response.statusCode === 401)).toBe(true); expect(zero.statusCode).toBe(400); expect(negative.statusCode).toBe(400); expect(invalid.statusCode).toBe(400); expect(internal.statusCode).toBe(400);
  });
});