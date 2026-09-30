import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type {
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord,
  CreatedAccount,
} from '../src/modules/auth/repository.js';
import type { CustomerRecord, CustomerRepository } from '../src/modules/customers/repository.js';
import type { CreateCustomerInput, UpdateCustomerInput } from '../src/modules/customers/schemas.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { buildApp } = await import('../src/app.js');

class MemoryAuthRepository implements AuthRepository {
  private users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord & { revokedAt?: Date }>();
  private sequence = 0;

  async createOrganizationWithOwner(input: {
    organizationName: string;
    slug: string;
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<CreatedAccount> {
    const id = String(++this.sequence);
    const organization = { id: `organization-${id}`, name: input.organizationName, slug: input.slug };
    const user: AuthUserRecord = {
      id: `user-${id}`,
      organizationId: organization.id,
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      role: UserRole.OWNER,
      organization,
    };
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

class MemoryCustomerRepository implements CustomerRepository {
  private customers: CustomerRecord[] = [];
  private sequence = 0;

  async create(organizationId: string, input: CreateCustomerInput): Promise<CustomerRecord> {
    const now = new Date();
    const customer: CustomerRecord = {
      id: `customer-${++this.sequence}`,
      organizationId,
      ...input,
      email: input.email ?? null,
      document: input.document ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.customers.push(customer);
    return customer;
  }

  list(organizationId: string): Promise<CustomerRecord[]> {
    return Promise.resolve(this.customers.filter((customer) => customer.organizationId === organizationId));
  }

  findById(organizationId: string, id: string): Promise<CustomerRecord | null> {
    return Promise.resolve(this.customers.find((customer) => customer.organizationId === organizationId && customer.id === id) ?? null);
  }

  async update(organizationId: string, id: string, input: UpdateCustomerInput): Promise<CustomerRecord | null> {
    const customer = this.customers.find((candidate) => candidate.organizationId === organizationId && candidate.id === id);
    if (!customer) return null;
    Object.assign(customer, input, { updatedAt: new Date() });
    return customer;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const index = this.customers.findIndex((customer) => customer.organizationId === organizationId && customer.id === id);
    if (index < 0) return false;
    this.customers.splice(index, 1);
    return true;
  }
}

describe('customer routes', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let customerRepository: MemoryCustomerRepository;
  let sequence = 0;

  beforeEach(async () => {
    authRepository = new MemoryAuthRepository();
    customerRepository = new MemoryCustomerRepository();
    app = buildApp({ authRepository, customerRepository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function loginForOrganization(name: string) {
    const id = ++sequence;
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: name,
        name: `${name} Owner`,
        email: `owner-${id}@example.com`,
        password: 'StrongPass1',
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' },
    });
    const setCookie = response.headers['set-cookie'];
    return String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  }

  async function createCustomer(cookie: string) {
    return app.inject({
      method: 'POST',
      url: '/api/customers',
      headers: { cookie },
      payload: { name: 'Maria Silva', email: 'maria@example.com', phone: '5511999999999' },
    });
  }

  it('allows an authenticated user to create, list, fetch, update, and delete a customer', async () => {
    const cookie = await loginForOrganization('Acme One');
    const created = await createCustomer(cookie);
    const customerId = created.json().customer.id;
    const list = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie } });
    const fetched = await app.inject({ method: 'GET', url: `/api/customers/${customerId}`, headers: { cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/customers/${customerId}`, headers: { cookie }, payload: { phone: '5511888888888' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/customers/${customerId}`, headers: { cookie } });

    expect(created.statusCode).toBe(201);
    expect(list.statusCode).toBe(200);
    expect(list.json().customers).toHaveLength(1);
    expect(fetched.statusCode).toBe(200);
    expect(updated.statusCode).toBe(200);
    expect(updated.json().customer.phone).toBe('5511888888888');
    expect(deleted.statusCode).toBe(204);
  });

  it('does not expose a customer to another organization', async () => {
    const ownerCookie = await loginForOrganization('Acme Two');
    const otherCookie = await loginForOrganization('Acme Three');
    const created = await createCustomer(ownerCookie);
    const customerId = created.json().customer.id;

    const fetched = await app.inject({ method: 'GET', url: `/api/customers/${customerId}`, headers: { cookie: otherCookie } });
    const listed = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: otherCookie } });

    expect(fetched.statusCode).toBe(404);
    expect(listed.json().customers).toHaveLength(0);
  });

  it('does not allow another organization to update or delete a customer', async () => {
    const ownerCookie = await loginForOrganization('Acme Four');
    const otherCookie = await loginForOrganization('Acme Five');
    const created = await createCustomer(ownerCookie);
    const customerId = created.json().customer.id;

    const updated = await app.inject({ method: 'PATCH', url: `/api/customers/${customerId}`, headers: { cookie: otherCookie }, payload: { name: 'Attacker' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/customers/${customerId}`, headers: { cookie: otherCookie } });
    const ownerRead = await app.inject({ method: 'GET', url: `/api/customers/${customerId}`, headers: { cookie: ownerCookie } });

    expect(updated.statusCode).toBe(404);
    expect(deleted.statusCode).toBe(404);
    expect(ownerRead.statusCode).toBe(200);
    expect(ownerRead.json().customer.name).toBe('Maria Silva');
  });

  it('requires authentication for all customer operations', async () => {
    const requests = await Promise.all([
      app.inject({ method: 'POST', url: '/api/customers', payload: { name: 'Maria Silva', phone: '123' } }),
      app.inject({ method: 'GET', url: '/api/customers' }),
      app.inject({ method: 'GET', url: '/api/customers/customer-1' }),
      app.inject({ method: 'PATCH', url: '/api/customers/customer-1', payload: { name: 'Other' } }),
      app.inject({ method: 'DELETE', url: '/api/customers/customer-1' }),
    ]);

    expect(requests.every((response) => response.statusCode === 401)).toBe(true);
  });

  it('rejects invalid customer data and ignores tenant fields by rejecting them', async () => {
    const cookie = await loginForOrganization('Acme Six');
    const invalid = await app.inject({ method: 'POST', url: '/api/customers', headers: { cookie }, payload: { name: 'A', phone: '' } });
    const tenantField = await app.inject({ method: 'POST', url: '/api/customers', headers: { cookie }, payload: { name: 'Valid Name', phone: '123', organizationId: 'other-organization' } });
    const emptyUpdate = await app.inject({ method: 'PATCH', url: '/api/customers/customer-1', headers: { cookie }, payload: {} });

    expect(invalid.statusCode).toBe(400);
    expect(tenantField.statusCode).toBe(400);
    expect(emptyUpdate.statusCode).toBe(400);
  });
});