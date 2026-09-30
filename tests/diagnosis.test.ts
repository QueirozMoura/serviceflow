import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import { DiagnosisAlreadyExistsError, type DiagnosisRecord, type DiagnosisRepository } from '../src/modules/diagnosis/repository.js';
import type { CreateDiagnosisInput, UpdateDiagnosisInput } from '../src/modules/diagnosis/schemas.js';

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

class MemoryDiagnosisRepository implements DiagnosisRepository {
  private diagnoses: DiagnosisRecord[] = [];
  private serviceOrders = new Map<string, string>();
  private sequence = 0;

  seedServiceOrder(serviceOrderId: string, organizationId: string): void { this.serviceOrders.set(serviceOrderId, organizationId); }

  serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean> {
    return Promise.resolve(this.serviceOrders.get(serviceOrderId) === organizationId);
  }

  findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<DiagnosisRecord | null> {
    return Promise.resolve(this.diagnoses.find((diagnosis) => diagnosis.serviceOrderId === serviceOrderId && this.serviceOrders.get(serviceOrderId) === organizationId) ?? null);
  }

  async create(organizationId: string, serviceOrderId: string, input: CreateDiagnosisInput): Promise<DiagnosisRecord> {
    if (this.diagnoses.some((diagnosis) => diagnosis.serviceOrderId === serviceOrderId)) throw new DiagnosisAlreadyExistsError();
    const now = new Date();
    const diagnosis: DiagnosisRecord = {
      id: `diagnosis-${++this.sequence}`,
      serviceOrderId,
      description: input.description,
      estimatedCost: input.estimatedCost ? new Prisma.Decimal(input.estimatedCost) : null,
      createdAt: now,
      updatedAt: now,
      serviceOrder: { id: serviceOrderId, orderNumber: 'OS-20260930-00000001', status: 'RECEIVED' },
    };
    this.diagnoses.push(diagnosis);
    return diagnosis;
  }

  async update(organizationId: string, serviceOrderId: string, input: UpdateDiagnosisInput): Promise<DiagnosisRecord | null> {
    const diagnosis = await this.findByServiceOrder(organizationId, serviceOrderId);
    if (!diagnosis) return null;
    Object.assign(diagnosis, input, { updatedAt: new Date() });
    return diagnosis;
  }

  async delete(organizationId: string, serviceOrderId: string): Promise<boolean> {
    const index = this.diagnoses.findIndex((diagnosis) => diagnosis.serviceOrderId === serviceOrderId && this.serviceOrders.get(serviceOrderId) === organizationId);
    if (index < 0) return false;
    this.diagnoses.splice(index, 1);
    return true;
  }
}

describe('diagnosis routes', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let diagnosisRepository: MemoryDiagnosisRepository;
  let sequence = 0;

  beforeEach(async () => {
    authRepository = new MemoryAuthRepository();
    diagnosisRepository = new MemoryDiagnosisRepository();
    app = buildApp({ authRepository, diagnosisRepository });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  async function loginForOrganization(name: string) {
    const id = ++sequence;
    const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: name, name: `${name} Owner`, email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const setCookie = login.headers['set-cookie'];
    return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0], organizationId: registration.json().user.organizationId as string };
  }

  it('creates, views, updates, and deletes a diagnosis for the authenticated organization', async () => {
    const owner = await loginForOrganization('Diagnosis One');
    const serviceOrderId = '11111111-1111-4111-8111-111111111111';
    diagnosisRepository.seedServiceOrder(serviceOrderId, owner.organizationId);
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: owner.cookie }, payload: { description: 'Fonte de alimentação danificada', estimatedCost: '85.50' } });
    const viewed = await app.inject({ method: 'GET', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: owner.cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: owner.cookie }, payload: { description: 'Fonte e cabo danificados' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: owner.cookie } });

    expect(created.statusCode).toBe(201);
    expect(created.json().diagnosis.serviceOrderId).toBe(serviceOrderId);
    expect(viewed.statusCode).toBe(200);
    expect(updated.statusCode).toBe(200);
    expect(updated.json().diagnosis.description).toBe('Fonte e cabo danificados');
    expect(deleted.statusCode).toBe(204);
  });

  it('does not expose or modify a diagnosis through another organization', async () => {
    const first = await loginForOrganization('Diagnosis Two');
    const second = await loginForOrganization('Diagnosis Three');
    const serviceOrderId = '22222222-2222-4222-8222-222222222222';
    diagnosisRepository.seedServiceOrder(serviceOrderId, first.organizationId);
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: first.cookie }, payload: { description: 'Diagnóstico privado' } });

    const viewed = await app.inject({ method: 'GET', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: second.cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: second.cookie }, payload: { description: 'Acesso indevido' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: second.cookie } });
    const ownerViewed = await app.inject({ method: 'GET', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: first.cookie } });

    expect(created.statusCode).toBe(201);
    expect(viewed.statusCode).toBe(404);
    expect(updated.statusCode).toBe(404);
    expect(deleted.statusCode).toBe(404);
    expect(ownerViewed.statusCode).toBe(200);
  });

  it('rejects creation on another organization OS and duplicate diagnoses', async () => {
    const first = await loginForOrganization('Diagnosis Four');
    const second = await loginForOrganization('Diagnosis Five');
    const serviceOrderId = '33333333-3333-4333-8333-333333333333';
    diagnosisRepository.seedServiceOrder(serviceOrderId, first.organizationId);
    const otherTenant = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: second.cookie }, payload: { description: 'Outro tenant' } });
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: first.cookie }, payload: { description: 'Primeiro diagnóstico' } });
    const duplicate = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/diagnosis`, headers: { cookie: first.cookie }, payload: { description: 'Segundo diagnóstico' } });

    expect(otherTenant.statusCode).toBe(404);
    expect(created.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
  });

  it('requires authentication, rejects invalid data, and ignores internal body fields', async () => {
    const unauthorized = await Promise.all([
      app.inject({ method: 'POST', url: '/api/service-orders/order-1/diagnosis', payload: { description: 'Test' } }),
      app.inject({ method: 'GET', url: '/api/service-orders/order-1/diagnosis' }),
      app.inject({ method: 'PATCH', url: '/api/service-orders/order-1/diagnosis', payload: { description: 'Test' } }),
      app.inject({ method: 'DELETE', url: '/api/service-orders/order-1/diagnosis' }),
    ]);
    const owner = await loginForOrganization('Diagnosis Six');
    const invalid = await app.inject({ method: 'POST', url: '/api/service-orders/order-1/diagnosis', headers: { cookie: owner.cookie }, payload: { description: 'A' } });
    const internalFields = await app.inject({ method: 'POST', url: '/api/service-orders/order-1/diagnosis', headers: { cookie: owner.cookie }, payload: { description: 'Valid description', organizationId: 'other', serviceOrderId: 'other' } });

    expect(unauthorized.every((response) => response.statusCode === 401)).toBe(true);
    expect(invalid.statusCode).toBe(400);
    expect(internalFields.statusCode).toBe(400);
  });
});