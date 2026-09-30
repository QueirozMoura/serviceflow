import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServiceOrderStatus, UserRole, Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import type { ServiceOrderRecord, ServiceOrderRepository } from '../src/modules/service-orders/repository.js';
import type { CreateServiceOrderInput, UpdateServiceOrderInput } from '../src/modules/service-orders/schemas.js';

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

  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    const session = this.sessions.get(tokenHash);
    return Promise.resolve(session && !session.revokedAt ? session : null);
  }

  async revokeSession(tokenHash: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = new Date();
  }
}

class MemoryServiceOrderRepository implements ServiceOrderRepository {
  private orders: ServiceOrderRecord[] = [];
  readonly histories: Array<{ serviceOrderId: string; organizationId: string; fromStatus: ServiceOrderStatus | null; toStatus: ServiceOrderStatus; changedByUserId: string }> = [];
  private customers = new Map<string, { organizationId: string; name: string }>();
  private equipment = new Map<string, { organizationId: string; customerId: string; type: string }>();
  private sequence = 0;

  seedCustomer(id: string, organizationId: string, name: string): void { this.customers.set(id, { organizationId, name }); }
  seedEquipment(id: string, organizationId: string, customerId: string, type = 'Notebook'): void { this.equipment.set(id, { organizationId, customerId, type }); }

  referencesBelongToOrganization(organizationId: string, customerId: string, equipmentId: string): Promise<boolean> {
    const customer = this.customers.get(customerId);
    const equipment = this.equipment.get(equipmentId);
    return Promise.resolve(customer?.organizationId === organizationId && equipment?.organizationId === organizationId && equipment.customerId === customerId);
  }

  async create(organizationId: string, changedByUserId: string, input: CreateServiceOrderInput): Promise<ServiceOrderRecord> {
    const now = new Date();
    const customer = this.customers.get(input.customerId);
    const equipment = this.equipment.get(input.equipmentId);
    if (!customer || !equipment) throw new Error('Invalid references');
    const order: ServiceOrderRecord = {
      id: `order-${++this.sequence}`,
      organizationId,
      customerId: input.customerId,
      equipmentId: input.equipmentId,
      orderNumber: `OS-20260930-${String(this.sequence).padStart(8, '0')}`,
      status: ServiceOrderStatus.RECEIVED,
      problemDescription: input.problemDescription,
      technicianNotes: input.technicianNotes ?? null,
      estimatedValue: input.estimatedValue ? new Prisma.Decimal(input.estimatedValue) : null,
      finalValue: input.finalValue ? new Prisma.Decimal(input.finalValue) : null,
      receivedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      customer: { id: input.customerId, name: customer.name },
      equipment: { id: input.equipmentId, type: equipment.type, brand: null, model: null },
    };
    this.orders.push(order);
    this.histories.push({ serviceOrderId: order.id, organizationId, fromStatus: null, toStatus: order.status, changedByUserId });
    return order;
  }

  list(organizationId: string, filters: { status?: ServiceOrderStatus; customerId?: string; equipmentId?: string }): Promise<ServiceOrderRecord[]> {
    return Promise.resolve(this.orders.filter((order) => order.organizationId === organizationId && (!filters.status || order.status === filters.status) && (!filters.customerId || order.customerId === filters.customerId) && (!filters.equipmentId || order.equipmentId === filters.equipmentId)));
  }

  findById(organizationId: string, id: string): Promise<ServiceOrderRecord | null> { return Promise.resolve(this.orders.find((order) => order.organizationId === organizationId && order.id === id) ?? null); }

  async update(organizationId: string, id: string, input: UpdateServiceOrderInput): Promise<ServiceOrderRecord | null> {
    const order = this.orders.find((candidate) => candidate.organizationId === organizationId && candidate.id === id);
    if (!order) return null;
    Object.assign(order, input, { updatedAt: new Date() });
    return order;
  }

  async updateStatus(organizationId: string, id: string, changedByUserId: string, status: ServiceOrderStatus): Promise<ServiceOrderRecord | null> {
    const order = this.orders.find((candidate) => candidate.organizationId === organizationId && candidate.id === id);
    if (!order) return null;
    const fromStatus = order.status;
    order.status = status;
    order.updatedAt = new Date();
    this.histories.push({ serviceOrderId: id, organizationId, fromStatus, toStatus: status, changedByUserId });
    return order;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const index = this.orders.findIndex((order) => order.organizationId === organizationId && order.id === id);
    if (index < 0) return false;
    this.orders.splice(index, 1);
    return true;
  }
}

describe('service order routes', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let serviceOrderRepository: MemoryServiceOrderRepository;
  let sequence = 0;

  beforeEach(async () => {
    authRepository = new MemoryAuthRepository();
    serviceOrderRepository = new MemoryServiceOrderRepository();
    app = buildApp({ authRepository, serviceOrderRepository });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  async function loginForOrganization(name: string) {
    const id = ++sequence;
    const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: name, name: `${name} Owner`, email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const setCookie = login.headers['set-cookie'];
    return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0], organizationId: registration.json().user.organizationId as string, userId: registration.json().user.id as string };
  }

  function orderPayload(customerId: string, equipmentId: string, extra: Record<string, unknown> = {}) {
    return { customerId, equipmentId, problemDescription: 'Tela não liga', ...extra };
  }

  it('creates, lists, fetches, updates, filters, and deletes an order in its organization', async () => {
    const owner = await loginForOrganization('Orders One');
    const customerId = '11111111-1111-4111-8111-111111111111';
    const equipmentId = '22222222-2222-4222-8222-222222222222';
    serviceOrderRepository.seedCustomer(customerId, owner.organizationId, 'Customer One');
    serviceOrderRepository.seedEquipment(equipmentId, owner.organizationId, customerId);
    const created = await app.inject({ method: 'POST', url: '/api/service-orders', headers: { cookie: owner.cookie }, payload: orderPayload(customerId, equipmentId, { estimatedValue: '125.50' }) });
    const id = created.json().serviceOrder.id;
    const list = await app.inject({ method: 'GET', url: '/api/service-orders?status=RECEIVED', headers: { cookie: owner.cookie } });
    const fetched = await app.inject({ method: 'GET', url: `/api/service-orders/${id}`, headers: { cookie: owner.cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/service-orders/${id}`, headers: { cookie: owner.cookie }, payload: { technicianNotes: 'Aguardando diagnóstico' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/service-orders/${id}`, headers: { cookie: owner.cookie } });

    expect(created.statusCode).toBe(201);
    expect(created.json().serviceOrder.status).toBe('RECEIVED');
    expect(created.json().serviceOrder.orderNumber).toMatch(/^OS-\d{8}-[A-F0-9]{8}$/);
    expect(list.json().serviceOrders).toHaveLength(1);
    expect(fetched.statusCode).toBe(200);
    expect(updated.json().serviceOrder.technicianNotes).toBe('Aguardando diagnóstico');
    expect(deleted.statusCode).toBe(204);
  });

  it('rejects customers, equipment, and customer-equipment pairs from another context', async () => {
    const first = await loginForOrganization('Orders Two');
    const second = await loginForOrganization('Orders Three');
    const firstCustomer = '33333333-3333-4333-8333-333333333333';
    const secondCustomer = '44444444-4444-4444-8444-444444444444';
    const firstEquipment = '55555555-5555-4555-8555-555555555555';
    const secondEquipment = '66666666-6666-4666-8666-666666666666';
    serviceOrderRepository.seedCustomer(firstCustomer, first.organizationId, 'Customer First');
    serviceOrderRepository.seedCustomer(secondCustomer, second.organizationId, 'Customer Second');
    serviceOrderRepository.seedEquipment(firstEquipment, first.organizationId, firstCustomer);
    serviceOrderRepository.seedEquipment(secondEquipment, second.organizationId, secondCustomer);

    const otherCustomer = await app.inject({ method: 'POST', url: '/api/service-orders', headers: { cookie: second.cookie }, payload: orderPayload(firstCustomer, secondEquipment) });
    const otherEquipment = await app.inject({ method: 'POST', url: '/api/service-orders', headers: { cookie: first.cookie }, payload: orderPayload(firstCustomer, secondEquipment) });
    const otherPair = await app.inject({ method: 'POST', url: '/api/service-orders', headers: { cookie: first.cookie }, payload: orderPayload(secondCustomer, firstEquipment) });

    expect(otherCustomer.statusCode).toBe(400);
    expect(otherEquipment.statusCode).toBe(400);
    expect(otherPair.statusCode).toBe(400);
  });

  it('isolates reads, updates, and deletes between organizations', async () => {
    const first = await loginForOrganization('Orders Four');
    const second = await loginForOrganization('Orders Five');
    const customerId = '77777777-7777-4777-8777-777777777777';
    const equipmentId = '88888888-8888-4888-8888-888888888888';
    serviceOrderRepository.seedCustomer(customerId, first.organizationId, 'Customer Four');
    serviceOrderRepository.seedEquipment(equipmentId, first.organizationId, customerId);
    const created = await app.inject({ method: 'POST', url: '/api/service-orders', headers: { cookie: first.cookie }, payload: orderPayload(customerId, equipmentId) });
    const id = created.json().serviceOrder.id;
    const fetched = await app.inject({ method: 'GET', url: `/api/service-orders/${id}`, headers: { cookie: second.cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/service-orders/${id}`, headers: { cookie: second.cookie }, payload: { technicianNotes: 'Attack' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/service-orders/${id}`, headers: { cookie: second.cookie } });
    const ownerRead = await app.inject({ method: 'GET', url: `/api/service-orders/${id}`, headers: { cookie: first.cookie } });

    expect(fetched.statusCode).toBe(404);
    expect(updated.statusCode).toBe(404);
    expect(deleted.statusCode).toBe(404);
    expect(ownerRead.statusCode).toBe(200);
  });

  it('supports valid status transitions and records complete history', async () => {
    const owner = await loginForOrganization('Orders Six');
    const customerId = '99999999-9999-4999-8999-999999999999';
    const equipmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    serviceOrderRepository.seedCustomer(customerId, owner.organizationId, 'Customer Six');
    serviceOrderRepository.seedEquipment(equipmentId, owner.organizationId, customerId);
    const created = await app.inject({ method: 'POST', url: '/api/service-orders', headers: { cookie: owner.cookie }, payload: orderPayload(customerId, equipmentId) });
    const id = created.json().serviceOrder.id;
    const diagnosis = await app.inject({ method: 'PATCH', url: `/api/service-orders/${id}/status`, headers: { cookie: owner.cookie }, payload: { status: 'WAITING_DIAGNOSIS' } });
    const approval = await app.inject({ method: 'PATCH', url: `/api/service-orders/${id}/status`, headers: { cookie: owner.cookie }, payload: { status: 'WAITING_APPROVAL' } });
    const invalid = await app.inject({ method: 'PATCH', url: `/api/service-orders/${id}/status`, headers: { cookie: owner.cookie }, payload: { status: 'DELIVERED' } });

    expect(diagnosis.statusCode).toBe(200);
    expect(approval.statusCode).toBe(200);
    expect(invalid.statusCode).toBe(409);
    expect(serviceOrderRepository.histories).toEqual([
      { serviceOrderId: id, organizationId: owner.organizationId, fromStatus: null, toStatus: ServiceOrderStatus.RECEIVED, changedByUserId: owner.userId },
      { serviceOrderId: id, organizationId: owner.organizationId, fromStatus: ServiceOrderStatus.RECEIVED, toStatus: ServiceOrderStatus.WAITING_DIAGNOSIS, changedByUserId: owner.userId },
      { serviceOrderId: id, organizationId: owner.organizationId, fromStatus: ServiceOrderStatus.WAITING_DIAGNOSIS, toStatus: ServiceOrderStatus.WAITING_APPROVAL, changedByUserId: owner.userId },
    ]);
  });

  it('requires authentication, validates input, and ignores no tenant field', async () => {
    const unauthorized = await Promise.all([
      app.inject({ method: 'POST', url: '/api/service-orders', payload: {} }),
      app.inject({ method: 'GET', url: '/api/service-orders' }),
      app.inject({ method: 'GET', url: '/api/service-orders/order-1' }),
      app.inject({ method: 'PATCH', url: '/api/service-orders/order-1', payload: {} }),
      app.inject({ method: 'PATCH', url: '/api/service-orders/order-1/status', payload: { status: 'RECEIVED' } }),
      app.inject({ method: 'DELETE', url: '/api/service-orders/order-1' }),
    ]);
    const owner = await loginForOrganization('Orders Seven');
    const invalid = await app.inject({ method: 'POST', url: '/api/service-orders', headers: { cookie: owner.cookie }, payload: { customerId: 'bad', equipmentId: 'bad', problemDescription: 'X' } });
    const tenantField = await app.inject({ method: 'POST', url: '/api/service-orders', headers: { cookie: owner.cookie }, payload: { customerId: '11111111-1111-4111-8111-111111111111', equipmentId: '22222222-2222-4222-8222-222222222222', problemDescription: 'X', organizationId: 'other' } });
    const invalidStatus = await app.inject({ method: 'PATCH', url: '/api/service-orders/order-1/status', headers: { cookie: owner.cookie }, payload: { status: 'NOT_A_STATUS' } });

    expect(unauthorized.every((response) => response.statusCode === 401)).toBe(true);
    expect(invalid.statusCode).toBe(400);
    expect(tenantField.statusCode).toBe(400);
    expect(invalidStatus.statusCode).toBe(400);
  });
});