import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import { RecipientChannelUnavailableError, type CreateMessageHistoryInput, type MessageContext, type MessageHistoryRecord, type MessageRepository } from '../src/modules/messages/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
const { createSessionToken, sessionExpiresAt } = await import('../src/modules/auth/session.js');
const { generateMessage } = await import('../src/modules/messages/message-generator.js');
const { Prisma } = await import('@prisma/client');

class MemoryAuthRepository implements AuthRepository {
  users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord>();
  async createOrganizationWithOwner(): Promise<CreatedAccount> { throw new Error('not used'); }
  findUsersByEmail(email: string): Promise<AuthUserRecord[]> { return Promise.resolve(this.users.filter((user) => user.email === email)); }
  findUserById(id: string): Promise<AuthUserRecord | null> { return Promise.resolve(this.users.find((user) => user.id === id) ?? null); }
  async updateUserName(): Promise<AuthUserRecord | null> { return null; }
  async createSession(input: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void> { const user = this.users.find((candidate) => candidate.id === input.userId)!; this.sessions.set(input.tokenHash, { expiresAt: input.expiresAt, user: { id: user.id, organizationId: user.organizationId, role: user.role } }); }
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> { return Promise.resolve(this.sessions.get(tokenHash) ?? null); }
  async revokeSession(): Promise<void> { return undefined; }
  findUserByOAuthAccount(): Promise<AuthUserRecord | null> { return Promise.resolve(null); }
  async linkOAuthAccount(): Promise<void> { return undefined; }
  createOrganizationWithOAuthUser(): Promise<CreatedAccount> { throw new Error('not used'); }
  async seed(role: UserRole, organizationId: string, name: string) {
    const id = `user-${this.users.length + 1}`;
    this.users.push({ id, organizationId, name, email: `${id}@example.com`, passwordHash: 'hash', role, organization: { id: organizationId, name: organizationId, slug: organizationId } });
    const { token, tokenHash } = createSessionToken();
    await this.createSession({ tokenHash, userId: id, organizationId, expiresAt: sessionExpiresAt() });
    return { id, cookie: `${env.AUTH_COOKIE_NAME}=${token}` };
  }
}

// Remove os campos internos do armazenamento em memoria (organizacao e chave de idempotencia).
const publicRecord = (row: MessageHistoryRecord & { organizationId: string; idempotencyKey: string | null }): MessageHistoryRecord => ({ id: row.id, serviceOrderId: row.serviceOrderId, type: row.type, channel: row.channel, status: row.status, content: row.content, createdAt: row.createdAt, createdBy: row.createdBy, recipient: row.recipient });

type StoredContext = { organizationId: string; context: MessageContext; email: string | null };
class MemoryMessageRepository implements MessageRepository {
  contexts = new Map<string, StoredContext>();
  rows: Array<MessageHistoryRecord & { organizationId: string; idempotencyKey: string | null }> = [];
  failOnCreate = false;
  organizationsSeen: string[] = [];
  private sequence = 0;
  constructor(private readonly users: MemoryAuthRepository) {}
  set(organizationId: string, serviceOrderId: string, context: Omit<MessageContext, 'id'>, email: string | null = null) { this.contexts.set(serviceOrderId, { organizationId, context: { ...context, id: serviceOrderId }, email }); }
  async findContext(organizationId: string, serviceOrderId: string): Promise<MessageContext | null> { this.organizationsSeen.push(organizationId); const entry = this.contexts.get(serviceOrderId); return entry && entry.organizationId === organizationId ? entry.context : null; }
  async listHistory(organizationId: string, serviceOrderId: string): Promise<MessageHistoryRecord[] | null> {
    this.organizationsSeen.push(organizationId);
    const entry = this.contexts.get(serviceOrderId);
    if (!entry || entry.organizationId !== organizationId) return null;
    return this.rows.filter((row) => row.organizationId === organizationId && row.serviceOrderId === serviceOrderId).map(publicRecord).reverse();
  }
  async findHistoryByKey(organizationId: string, key: string): Promise<MessageHistoryRecord | null> { const row = this.rows.find((candidate) => candidate.organizationId === organizationId && candidate.idempotencyKey === key); return row ? publicRecord(row) : null; }
  async createHistory(input: CreateMessageHistoryInput): Promise<{ record: MessageHistoryRecord; created: boolean } | null> {
    this.organizationsSeen.push(input.organizationId);
    const entry = this.contexts.get(input.serviceOrderId);
    if (!entry || entry.organizationId !== input.organizationId) return null;
    if (input.channel === 'EMAIL' && !entry.email) throw new RecipientChannelUnavailableError('EMAIL');
    if (this.failOnCreate) throw new Prisma.PrismaClientKnownRequestError('database unavailable', { code: 'P1001', clientVersion: 'test' });
    if (input.idempotencyKey) { const existing = await this.findHistoryByKey(input.organizationId, input.idempotencyKey); if (existing) return { record: existing, created: false }; }
    const author = this.users.users.find((user) => user.id === input.createdByUserId)!;
    const record: MessageHistoryRecord = { id: `message-${++this.sequence}`, serviceOrderId: input.serviceOrderId, type: input.type, channel: input.channel, status: 'DRAFT', content: input.content, createdAt: new Date(2026, 9, 16, 12, 0, this.sequence), createdBy: { name: author.name }, recipient: { name: entry.context.customer.name } };
    this.rows.push({ ...record, organizationId: input.organizationId, idempotencyKey: input.idempotencyKey ?? null });
    return { record, created: true };
  }
}

const customerPhone = '5511988887777';
const baseContext = (customerName: string): Omit<MessageContext, 'id'> => ({ orderNumber: `OS-${customerName}`, customer: { name: customerName, phone: customerPhone }, equipment: { type: 'Notebook', brand: 'Dell', model: 'Inspiron' } });
const withDiagnosis = (customerName: string): Omit<MessageContext, 'id'> => ({ ...baseContext(customerName), diagnosis: { description: 'Fonte queimada' } });

describe('message history routes', () => {
  let app: FastifyInstance;
  let users: MemoryAuthRepository;
  let messages: MemoryMessageRepository;
  const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222', missing: '33333333-3333-4333-8333-333333333333' };

  beforeEach(async () => {
    users = new MemoryAuthRepository();
    messages = new MemoryMessageRepository(users);
    messages.set('org-a', ids.a, baseContext('Alice'));
    messages.set('org-b', ids.b, baseContext('Bruno'), 'bruno@example.com');
    app = buildApp({ authRepository: users, messageRepository: messages });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const url = (serviceOrderId: string) => `/api/service-orders/${serviceOrderId}/messages/history`;
  const post = (serviceOrderId: string, cookie: string | undefined, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: url(serviceOrderId), headers: { ...(cookie ? { cookie } : {}), ...headers }, payload: payload as object });
  const get = (serviceOrderId: string, cookie?: string) => app.inject({ method: 'GET', url: url(serviceOrderId), headers: cookie ? { cookie } : {} });
  const draft = { type: 'SERVICE_RECEIVED', channel: 'WHATSAPP' };

  describe('authentication and roles', () => {
    it('answers 401 without a valid session', async () => {
      expect((await get(ids.a)).statusCode).toBe(401);
      expect((await post(ids.a, undefined, draft)).statusCode).toBe(401);
      expect((await get(ids.a, `${env.AUTH_COOKIE_NAME}=forged`)).statusCode).toBe(401);
      expect((await post(ids.a, `${env.AUTH_COOKIE_NAME}=forged`, draft)).statusCode).toBe(401);
      expect(messages.rows).toEqual([]);
    });

    it.each([UserRole.OWNER, UserRole.ADMIN, UserRole.TECHNICIAN])('lets %s record and read the history of their own organization', async (role) => {
      const actor = await users.seed(role, 'org-a', `${role} Person`);
      const created = await post(ids.a, actor.cookie, draft);
      expect(created.statusCode).toBe(201);
      expect(created.json().message.createdBy).toEqual({ name: `${role} Person` });
      expect((await get(ids.a, actor.cookie)).json().messages).toHaveLength(1);
    });

    it('denies an unknown role instead of assuming access', async () => {
      const actor = await users.seed('AUDITOR' as unknown as UserRole, 'org-a', 'Auditor');
      expect((await get(ids.a, actor.cookie)).statusCode).toBe(403);
      expect((await post(ids.a, actor.cookie, draft)).statusCode).toBe(403);
      expect(messages.rows).toEqual([]);
    });
  });

  describe('validation', () => {
    it.each([
      ['unknown channel', { type: 'SERVICE_RECEIVED', channel: 'SMS' }],
      ['missing channel', { type: 'SERVICE_RECEIVED' }],
      ['unknown type', { type: 'NOPE', channel: 'WHATSAPP' }],
      ['missing type', { channel: 'WHATSAPP' }],
      ['lowercase channel', { type: 'SERVICE_RECEIVED', channel: 'whatsapp' }],
      ['client-supplied content', { ...draft, content: 'Texto livre' }],
      ['client-supplied status', { ...draft, status: 'SENT' }],
      ['client-supplied organization', { ...draft, organizationId: 'org-b' }],
      ['client-supplied sender', { ...draft, createdByUserId: 'user-9' }],
      ['client-supplied recipient', { ...draft, customerId: 'customer-9' }],
    ])('rejects %s with 400 and stores nothing', async (_label, payload) => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      const response = await post(ids.a, actor.cookie, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe('Invalid message data');
      expect(messages.rows).toEqual([]);
    });

    it('rejects a missing body and malformed idempotency keys', async () => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      expect((await app.inject({ method: 'POST', url: url(ids.a), headers: { cookie: actor.cookie } })).statusCode).toBe(400);
      for (const key of ['short', 'has space in it', 'x'.repeat(81), 'inválida-çã']) {
        const response = await post(ids.a, actor.cookie, draft, { 'idempotency-key': key });
        expect(response.statusCode, key).toBe(400);
      }
      expect(messages.rows).toEqual([]);
    });
  });

  describe('recording a draft', () => {
    it('stores a DRAFT whose content is generated by the server and never claims to be sent', async () => {
      const actor = await users.seed(UserRole.TECHNICIAN, 'org-a', 'Tecnico');
      const response = await post(ids.a, actor.cookie, draft);
      const body = response.json();

      expect(response.statusCode).toBe(201);
      expect(body.sendingAvailable).toBe(false);
      expect(body.message).toMatchObject({ type: 'SERVICE_RECEIVED', channel: 'WHATSAPP', status: 'DRAFT', recipient: { name: 'Alice' } });
      expect(body.message.content).toBe(generateMessage('SERVICE_RECEIVED', { ...baseContext('Alice'), id: ids.a }).message);
      expect(Object.keys(body.message).sort()).toEqual(['channel', 'content', 'createdAt', 'createdBy', 'id', 'recipient', 'status', 'type']);
      // Sem telefone do cliente, sem ids internos, sem organizacao.
      expect(response.body).not.toMatch(new RegExp(`${customerPhone}|organizationId|org-a|user-|sentAt|SENT`));
    });

    it('answers 404 for a service order that does not exist, without storing anything', async () => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      expect((await post(ids.missing, actor.cookie, draft)).statusCode).toBe(404);
      expect(messages.rows).toEqual([]);
    });

    it('answers 409 when the template needs data that does not exist yet', async () => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      const response = await post(ids.a, actor.cookie, { type: 'DIAGNOSIS_READY', channel: 'WHATSAPP' });
      expect(response.statusCode).toBe(409);
      expect(messages.rows).toEqual([]);
      messages.set('org-a', ids.a, withDiagnosis('Alice'));
      const ready = await post(ids.a, actor.cookie, { type: 'DIAGNOSIS_READY', channel: 'WHATSAPP' });
      expect(ready.statusCode).toBe(201);
      expect(ready.json().message.content).toContain('Fonte queimada');
    });

    it('requires an e-mail address on the customer to register an e-mail draft', async () => {
      const alice = await users.seed(UserRole.OWNER, 'org-a', 'Dono A');
      const bruno = await users.seed(UserRole.OWNER, 'org-b', 'Dono B');
      expect((await post(ids.a, alice.cookie, { ...draft, channel: 'EMAIL' })).statusCode).toBe(409);
      expect(messages.rows).toEqual([]);
      const ok = await post(ids.b, bruno.cookie, { ...draft, channel: 'EMAIL' });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().message.channel).toBe('EMAIL');
      expect(ok.body).not.toContain('bruno@example.com');
    });

    it('reports a persistence failure as an error and never as a recorded message', async () => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      messages.failOnCreate = true;
      const response = await post(ids.a, actor.cookie, draft);

      expect(response.statusCode).toBe(500);
      expect(response.json()).not.toHaveProperty('message.id');
      expect(response.json().error).toBe('Internal Server Error');
      messages.failOnCreate = false;
      expect((await get(ids.a, actor.cookie)).json().messages).toEqual([]);
    });
  });

  describe('idempotency', () => {
    const key = 'draft-key-0001';

    it('returns the same record for a repeated request and stores it once', async () => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      const first = await post(ids.a, actor.cookie, draft, { 'idempotency-key': key });
      const second = await post(ids.a, actor.cookie, draft, { 'idempotency-key': key });

      expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
      expect(second.json().message.id).toBe(first.json().message.id);
      expect(messages.rows).toHaveLength(1);
    });

    it('refuses to reuse a key for different data', async () => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      await post(ids.a, actor.cookie, draft, { 'idempotency-key': key });
      const otherType = await post(ids.a, actor.cookie, { ...draft, type: 'SERVICE_READY' }, { 'idempotency-key': key });
      const otherChannel = await post(ids.a, actor.cookie, { ...draft, channel: 'EMAIL' }, { 'idempotency-key': key });

      expect([otherType.statusCode, otherChannel.statusCode]).toEqual([409, 409]);
      expect(messages.rows).toHaveLength(1);
    });

    it('keeps keys independent between organizations', async () => {
      const alice = await users.seed(UserRole.OWNER, 'org-a', 'Dono A');
      const bruno = await users.seed(UserRole.OWNER, 'org-b', 'Dono B');
      const first = await post(ids.a, alice.cookie, draft, { 'idempotency-key': key });
      const other = await post(ids.b, bruno.cookie, draft, { 'idempotency-key': key });

      expect([first.statusCode, other.statusCode]).toEqual([201, 201]);
      expect(other.json().message.id).not.toBe(first.json().message.id);
      expect(other.json().message.recipient).toEqual({ name: 'Bruno' });
    });

    it('creates one record per request when no key is sent', async () => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      await post(ids.a, actor.cookie, draft);
      await post(ids.a, actor.cookie, draft);
      expect(messages.rows).toHaveLength(2);
    });
  });

  describe('history', () => {
    it('lists the records of the order newest first, with an empty list when there are none', async () => {
      const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
      const empty = await get(ids.a, actor.cookie);
      expect(empty.json()).toEqual({ messages: [], sendingAvailable: false });

      await post(ids.a, actor.cookie, draft);
      await post(ids.a, actor.cookie, { type: 'SERVICE_READY', channel: 'WHATSAPP' });
      const list = (await get(ids.a, actor.cookie)).json();
      expect(list.messages.map((message: { type: string }) => message.type)).toEqual(['SERVICE_READY', 'SERVICE_RECEIVED']);
      expect(list.messages.every((message: { status: string }) => message.status === 'DRAFT')).toBe(true);
    });

    it('does not reveal orders or messages of another organization, and ignores client-sent identity', async () => {
      const alice = await users.seed(UserRole.OWNER, 'org-a', 'Dono A');
      const bruno = await users.seed(UserRole.OWNER, 'org-b', 'Dono B');
      await post(ids.b, bruno.cookie, draft);

      const foreign = await get(ids.b, alice.cookie);
      const absent = await get(ids.missing, alice.cookie);
      expect([foreign.statusCode, absent.statusCode]).toEqual([404, 404]);
      expect(foreign.json()).toEqual(absent.json());
      expect((await post(ids.b, alice.cookie, draft)).statusCode).toBe(404);
      const forged = await app.inject({ method: 'GET', url: `${url(ids.b)}?organizationId=org-b`, headers: { cookie: alice.cookie } });
      expect(forged.statusCode).toBe(404);
      expect(messages.rows.filter((row) => row.organizationId === 'org-a')).toEqual([]);
      expect(new Set(messages.organizationsSeen.filter((organization) => organization === 'org-b')).size).toBeLessThanOrEqual(1);
    });
  });

  it('exposes no way to send a message and never reports one as sent', async () => {
    const actor = await users.seed(UserRole.OWNER, 'org-a', 'Dono');
    const created = await post(ids.a, actor.cookie, draft);
    const messageId = created.json().message.id as string;

    for (const [method, path] of [['POST', `${url(ids.a)}/${messageId}/send`], ['POST', `/api/service-orders/${ids.a}/messages/send`], ['PATCH', `${url(ids.a)}/${messageId}`], ['DELETE', `${url(ids.a)}/${messageId}`], ['PUT', url(ids.a)]] as const) {
      const response = await app.inject({ method, url: path, headers: { cookie: actor.cookie }, payload: { status: 'SENT' } });
      expect(response.statusCode, `${method} ${path}`).toBe(404);
    }
    const list = (await get(ids.a, actor.cookie)).body;
    expect(list).not.toMatch(/"status":"(SENT|PENDING|FAILED)"|sentAt/);
    expect(messages.rows.every((row) => row.status === 'DRAFT')).toBe(true);
  });

  it('keeps the existing generate-only route working and persistence-free', async () => {
    const actor = await users.seed(UserRole.TECHNICIAN, 'org-a', 'Tecnico');
    const response = await app.inject({ method: 'POST', url: `/api/service-orders/${ids.a}/messages`, headers: { cookie: actor.cookie }, payload: { type: 'SERVICE_RECEIVED' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().message).toContain('Alice');
    expect(messages.rows).toEqual([]);
  });
});
