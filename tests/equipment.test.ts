import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import type { EquipmentRecord, EquipmentRepository } from '../src/modules/equipment/repository.js';
import type { CreateEquipmentInput, UpdateEquipmentInput } from '../src/modules/equipment/schemas.js';

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

  findUsersByEmail(email: string): Promise<AuthUserRecord[]> {
    return Promise.resolve(this.users.filter((user) => user.email === email));
  }

  findUserById(id: string): Promise<AuthUserRecord | null> {
    return Promise.resolve(this.users.find((user) => user.id === id) ?? null);
  }

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

class MemoryEquipmentRepository implements EquipmentRepository {
  private equipment: EquipmentRecord[] = [];
  private customers = new Map<string, { organizationId: string; name: string }>();
  private sequence = 0;

  seedCustomer(id: string, organizationId: string, name: string): void {
    this.customers.set(id, { organizationId, name });
  }

  customerBelongsToOrganization(organizationId: string, customerId: string): Promise<boolean> {
    return Promise.resolve(this.customers.get(customerId)?.organizationId === organizationId);
  }

  async create(organizationId: string, input: CreateEquipmentInput): Promise<EquipmentRecord> {
    const customer = this.customers.get(input.customerId);
    if (!customer || customer.organizationId !== organizationId) throw new Error('Customer does not belong to organization');
    const now = new Date();
    const record: EquipmentRecord = { id: `equipment-${++this.sequence}`, organizationId, ...input, brand: input.brand ?? null, model: input.model ?? null, serialNumber: input.serialNumber ?? null, description: input.description ?? null, createdAt: now, updatedAt: now, customer: { id: input.customerId, name: customer.name } };
    this.equipment.push(record);
    return record;
  }

  list(organizationId: string, customerId?: string): Promise<EquipmentRecord[]> {
    return Promise.resolve(this.equipment.filter((item) => item.organizationId === organizationId && (!customerId || item.customerId === customerId)));
  }

  findById(organizationId: string, id: string): Promise<EquipmentRecord | null> {
    return Promise.resolve(this.equipment.find((item) => item.organizationId === organizationId && item.id === id) ?? null);
  }

  async update(organizationId: string, id: string, input: UpdateEquipmentInput): Promise<EquipmentRecord | null> {
    const item = this.equipment.find((candidate) => candidate.organizationId === organizationId && candidate.id === id);
    if (!item) return null;
    if (input.customerId) {
      const customer = this.customers.get(input.customerId);
      if (!customer || customer.organizationId !== organizationId) throw new Error('Customer does not belong to organization');
      item.customer = { id: input.customerId, name: customer.name };
    }
    Object.assign(item, input, { updatedAt: new Date() });
    return item;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const index = this.equipment.findIndex((item) => item.organizationId === organizationId && item.id === id);
    if (index < 0) return false;
    this.equipment.splice(index, 1);
    return true;
  }
}

describe('equipment routes', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let equipmentRepository: MemoryEquipmentRepository;
  let sequence = 0;

  beforeEach(async () => {
    authRepository = new MemoryAuthRepository();
    equipmentRepository = new MemoryEquipmentRepository();
    app = buildApp({ authRepository, equipmentRepository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function loginForOrganization(name: string) {
    const id = ++sequence;
    const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: name, name: `${name} Owner`, email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const organizationId = registration.json().user.organizationId as string;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const setCookie = login.headers['set-cookie'];
    return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0], organizationId };
  }

  function createEquipment(cookie: string, customerId: string, extra: Record<string, unknown> = {}) {
    return app.inject({ method: 'POST', url: '/api/equipment', headers: { cookie }, payload: { customerId, type: 'Notebook', brand: 'Lenovo', ...extra } });
  }

  it('allows authenticated CRUD and customer filtering', async () => {
    const owner = await loginForOrganization('Equipment One');
    equipmentRepository.seedCustomer('11111111-1111-4111-8111-111111111111', owner.organizationId, 'Customer One');
    const created = await createEquipment(owner.cookie, '11111111-1111-4111-8111-111111111111');
    const id = created.json().equipment.id;
    const list = await app.inject({ method: 'GET', url: '/api/equipment?customerId=11111111-1111-4111-8111-111111111111', headers: { cookie: owner.cookie } });
    const fetched = await app.inject({ method: 'GET', url: `/api/equipment/${id}`, headers: { cookie: owner.cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/equipment/${id}`, headers: { cookie: owner.cookie }, payload: { model: 'ThinkPad' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/equipment/${id}`, headers: { cookie: owner.cookie } });

    expect(created.statusCode).toBe(201);
    expect(created.json().equipment.customer.name).toBe('Customer One');
    expect(list.json().equipment).toHaveLength(1);
    expect(fetched.statusCode).toBe(200);
    expect(updated.json().equipment.model).toBe('ThinkPad');
    expect(deleted.statusCode).toBe(204);
  });

  it('isolates equipment reads, updates, and deletes between organizations', async () => {
    const first = await loginForOrganization('Equipment Two');
    const second = await loginForOrganization('Equipment Three');
    equipmentRepository.seedCustomer('22222222-2222-4222-8222-222222222222', first.organizationId, 'Customer Two');
    const created = await createEquipment(first.cookie, '22222222-2222-4222-8222-222222222222');
    const id = created.json().equipment.id;

    const fetched = await app.inject({ method: 'GET', url: `/api/equipment/${id}`, headers: { cookie: second.cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/equipment/${id}`, headers: { cookie: second.cookie }, payload: { model: 'Attacker' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/equipment/${id}`, headers: { cookie: second.cookie } });
    const ownerRead = await app.inject({ method: 'GET', url: `/api/equipment/${id}`, headers: { cookie: first.cookie } });

    expect(fetched.statusCode).toBe(404);
    expect(updated.statusCode).toBe(404);
    expect(deleted.statusCode).toBe(404);
    expect(ownerRead.statusCode).toBe(200);
  });

  it('rejects cross-tenant customers and organizationId from the request body', async () => {
    const first = await loginForOrganization('Equipment Four');
    const second = await loginForOrganization('Equipment Five');
    equipmentRepository.seedCustomer('33333333-3333-4333-8333-333333333333', first.organizationId, 'Customer Three');
    equipmentRepository.seedCustomer('44444444-4444-4444-8444-444444444444', second.organizationId, 'Customer Four');

    const crossTenant = await createEquipment(second.cookie, '33333333-3333-4333-8333-333333333333');
    const tenantField = await createEquipment(first.cookie, '33333333-3333-4333-8333-333333333333', { organizationId: second.organizationId });
    const crossTenantUpdate = await app.inject({ method: 'POST', url: '/api/equipment', headers: { cookie: first.cookie }, payload: { customerId: '44444444-4444-4444-8444-444444444444', type: 'Phone' } });

    expect(crossTenant.statusCode).toBe(400);
    expect(tenantField.statusCode).toBe(400);
    expect(crossTenantUpdate.statusCode).toBe(400);
  });

  it('requires authentication and rejects invalid data', async () => {
    const unauthorized = await Promise.all([
      app.inject({ method: 'POST', url: '/api/equipment', payload: { customerId: '11111111-1111-4111-8111-111111111111', type: 'Notebook' } }),
      app.inject({ method: 'GET', url: '/api/equipment' }),
      app.inject({ method: 'GET', url: '/api/equipment/equipment-1' }),
      app.inject({ method: 'PATCH', url: '/api/equipment/equipment-1', payload: { model: 'X' } }),
      app.inject({ method: 'DELETE', url: '/api/equipment/equipment-1' }),
    ]);
    const owner = await loginForOrganization('Equipment Six');
    const invalid = await createEquipment(owner.cookie, 'not-a-uuid', { type: 'X' });

    expect(unauthorized.every((response) => response.statusCode === 401)).toBe(true);
    expect(invalid.statusCode).toBe(400);
  });
});