import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, QuoteStatus, ServiceItemType, WarrantyStatus, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import { generateMessage, MessageDataUnavailableError } from '../src/modules/messages/message-generator.js';
import type { MessageContext, MessageRepository } from '../src/modules/messages/repository.js';
import type { MessageType } from '../src/modules/messages/schemas.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { buildApp } = await import('../src/app.js');

const baseContext: MessageContext = {
  id: 'order-1', orderNumber: 'OS-0001', customer: { name: 'Maria Silva', phone: '5511999999999' }, equipment: { type: 'Notebook', brand: 'Lenovo', model: 'ThinkPad' },
};
const diagnosis = { description: 'Fonte de alimentação danificada' };
const quote = { status: QuoteStatus.APPROVED, total: new Prisma.Decimal('350.00'), items: [{ description: 'Troca de componente', quantity: new Prisma.Decimal('1'), unitPrice: new Prisma.Decimal('150.00'), type: ServiceItemType.LABOR }, { description: 'Componente X', quantity: new Prisma.Decimal('1'), unitPrice: new Prisma.Decimal('200.00'), type: ServiceItemType.PART }] };
const warranty = { status: WarrantyStatus.ACTIVE, startDate: new Date('2026-10-01T00:00:00.000Z'), endDate: new Date('2026-11-01T00:00:00.000Z'), description: 'Cobertura para o serviço realizado.' };

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

class MemoryMessageRepository implements MessageRepository {
  private contexts = new Map<string, { organizationId: string; context: MessageContext }>();
  lastOrganizationId: string | null = null;
  set(organizationId: string, serviceOrderId: string, context: MessageContext): void { this.contexts.set(serviceOrderId, { organizationId, context }); }
  async findContext(organizationId: string, serviceOrderId: string, type: MessageType): Promise<MessageContext | null> { this.lastOrganizationId = organizationId; const entry = this.contexts.get(serviceOrderId); if (!entry || entry.organizationId !== organizationId) return null; if (type === 'DIAGNOSIS_READY' && !entry.context.diagnosis) return { ...entry.context }; return entry.context; }
}

describe('message generator', () => {
  it('generates all supported message types from database context', () => {
    const contexts: Record<MessageType, MessageContext> = {
      SERVICE_RECEIVED: baseContext,
      DIAGNOSIS_READY: { ...baseContext, diagnosis },
      QUOTE_READY: { ...baseContext, quote },
      QUOTE_APPROVED: { ...baseContext, quote },
      SERVICE_IN_PROGRESS: baseContext,
      SERVICE_READY: baseContext,
      SERVICE_DELIVERED: baseContext,
      WARRANTY_CREATED: { ...baseContext, warranty },
    };
    for (const type of Object.keys(contexts) as MessageType[]) {
      const result = generateMessage(type, contexts[type]);
      expect(result.type).toBe(type);
      expect(result.customer.name).toBe('Maria Silva');
      expect(result.phone).toBe('5511999999999');
      expect(result.message).toContain('OS-0001');
    }
    expect(generateMessage('QUOTE_READY', contexts.QUOTE_READY).message).toContain('R$ 350,00');
    expect(generateMessage('QUOTE_READY', contexts.QUOTE_READY).message).toContain('Componente X');
    expect(generateMessage('WARRANTY_CREATED', contexts.WARRANTY_CREATED).message).toContain('01/10/2026');
  });

  it('rejects missing or invalid data without inventing content', () => {
    expect(() => generateMessage('DIAGNOSIS_READY', baseContext)).toThrow(MessageDataUnavailableError);
    expect(() => generateMessage('QUOTE_READY', baseContext)).toThrow(MessageDataUnavailableError);
    expect(() => generateMessage('QUOTE_APPROVED', { ...baseContext, quote: { ...quote, status: QuoteStatus.PENDING } })).toThrow(MessageDataUnavailableError);
    expect(() => generateMessage('WARRANTY_CREATED', baseContext)).toThrow(MessageDataUnavailableError);
    expect(() => generateMessage('WARRANTY_CREATED', { ...baseContext, warranty: { ...warranty, status: WarrantyStatus.CANCELLED } })).toThrow(MessageDataUnavailableError);
  });
});

describe('message route', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let messageRepository: MemoryMessageRepository;
  let sequence = 0;

  beforeEach(async () => { authRepository = new MemoryAuthRepository(); messageRepository = new MemoryMessageRepository(); app = buildApp({ authRepository, messageRepository }); await app.ready(); });
  afterEach(async () => { await app.close(); });
  afterAll(() => undefined);

  async function login(name: string) { const id = ++sequence; const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: name, name: `${name} Owner`, email: `owner-${id}@example.com`, password: 'StrongPass1' } }); const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' } }); const setCookie = response.headers['set-cookie']; return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0], organizationId: registration.json().user.organizationId as string }; }

  it('generates a message for the authenticated tenant and never mutates context', async () => {
    const owner = await login('Messages One'); const context = { ...baseContext, quote }; messageRepository.set(owner.organizationId, baseContext.id, context); const before = JSON.stringify(context);
    const response = await app.inject({ method: 'POST', url: `/api/service-orders/${baseContext.id}/messages`, headers: { cookie: owner.cookie }, payload: { type: 'QUOTE_READY' } });
    expect(response.statusCode).toBe(200); expect(response.json().message).toContain('R$ 350,00'); expect(JSON.stringify(context)).toBe(before); expect(messageRepository.lastOrganizationId).toBe(owner.organizationId);
  });

  it('blocks unauthenticated and cross-tenant requests, including client tenant fields', async () => {
    const first = await login('Messages Two'); const second = await login('Messages Three'); messageRepository.set(first.organizationId, baseContext.id, baseContext);
    const unauthenticated = await app.inject({ method: 'POST', url: `/api/service-orders/${baseContext.id}/messages`, payload: { type: 'SERVICE_RECEIVED' } }); const crossTenant = await app.inject({ method: 'POST', url: `/api/service-orders/${baseContext.id}/messages`, headers: { cookie: second.cookie }, payload: { type: 'SERVICE_RECEIVED' } }); const internalFields = await app.inject({ method: 'POST', url: `/api/service-orders/${baseContext.id}/messages`, headers: { cookie: first.cookie }, payload: { type: 'SERVICE_RECEIVED', organizationId: second.organizationId, serviceOrderId: 'other' } });
    expect(unauthenticated.statusCode).toBe(401); expect(crossTenant.statusCode).toBe(404); expect(internalFields.statusCode).toBe(400);
  });

  it('returns a domain conflict for unavailable related data and rejects unknown types', async () => {
    const owner = await login('Messages Four'); messageRepository.set(owner.organizationId, baseContext.id, baseContext);
    const missing = await app.inject({ method: 'POST', url: `/api/service-orders/${baseContext.id}/messages`, headers: { cookie: owner.cookie }, payload: { type: 'DIAGNOSIS_READY' } }); const invalid = await app.inject({ method: 'POST', url: `/api/service-orders/${baseContext.id}/messages`, headers: { cookie: owner.cookie }, payload: { type: 'UNKNOWN' } });
    expect(missing.statusCode).toBe(409); expect(invalid.statusCode).toBe(400);
  });
});