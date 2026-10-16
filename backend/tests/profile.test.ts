import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserRole, type PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { PrismaAuthRepository, type AuthRepository, type AuthSessionRecord, type AuthUserRecord, type CreatedAccount } from '../src/modules/auth/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { buildApp } = await import('../src/app.js');

class MemoryAuthRepository implements AuthRepository {
  users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord & { revokedAt?: Date }>();
  private sequence = 0;
  async createOrganizationWithOwner(input: { organizationName: string; slug: string; name: string; email: string; passwordHash: string }): Promise<CreatedAccount> { const id = String(++this.sequence); const organization = { id: `organization-${id}`, name: input.organizationName, slug: input.slug }; const user: AuthUserRecord = { id: `user-${id}`, organizationId: organization.id, name: input.name, email: input.email, passwordHash: input.passwordHash, role: UserRole.OWNER, organization }; this.users.push(user); return { user, organization }; }
  findUsersByEmail(email: string): Promise<AuthUserRecord[]> { return Promise.resolve(this.users.filter((user) => user.email === email)); }
  findUserById(id: string): Promise<AuthUserRecord | null> { return Promise.resolve(this.users.find((user) => user.id === id) ?? null); }
  async updateUserName(id: string, organizationId: string, name: string): Promise<AuthUserRecord | null> { const user = this.users.find((candidate) => candidate.id === id && candidate.organizationId === organizationId); if (!user) return null; user.name = name; return user; }
  async createSession(input: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void> { const user = this.users.find((candidate) => candidate.id === input.userId); if (!user) throw new Error('User not found'); this.sessions.set(input.tokenHash, { expiresAt: input.expiresAt, user: { id: user.id, organizationId: user.organizationId, role: user.role } }); }
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> { const session = this.sessions.get(tokenHash); return Promise.resolve(session && !session.revokedAt ? session : null); }
  async revokeSession(tokenHash: string): Promise<void> { const session = this.sessions.get(tokenHash); if (session) session.revokedAt = new Date(); }
  findUserByOAuthAccount(): Promise<AuthUserRecord | null> { return Promise.resolve(null); }
  async linkOAuthAccount(): Promise<void> { return undefined; }
  createOrganizationWithOAuthUser(): Promise<CreatedAccount> { throw new Error('not used'); }
}

describe('PATCH /api/auth/me', () => {
  let app: FastifyInstance;
  let repository: MemoryAuthRepository;
  let sequence = 0;

  beforeEach(async () => { repository = new MemoryAuthRepository(); app = buildApp({ authRepository: repository }); await app.ready(); });
  afterEach(async () => { await app.close(); });

  async function account(name: string) {
    const id = ++sequence;
    const email = `user-${id}@example.com`;
    const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: `Org ${name}`, name, email, password: 'StrongPass1' } });
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'StrongPass1' } });
    const setCookie = response.headers['set-cookie'];
    return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] as string, id: registration.json().user.id as string, organizationId: registration.json().user.organizationId as string, email };
  }
  const patch = (cookie: string | undefined, payload: unknown, url = '/api/auth/me') => app.inject({ method: 'PATCH', url, headers: cookie ? { cookie } : {}, payload: payload as object });
  const stored = (id: string) => repository.users.find((user) => user.id === id)!;

  it('returns the authenticated profile without secrets', async () => {
    const alice = await account('Alice');
    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: alice.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ id: alice.id, name: 'Alice', email: alice.email, role: 'OWNER', organization: { name: 'Org Alice' } });
    expect(response.body).not.toMatch(/passwordHash|tokenHash/);
  });

  it('updates the name (trimmed) and returns the same shape as GET /me', async () => {
    const alice = await account('Alice');
    const response = await patch(alice.cookie, { name: '  Alice Souza  ' });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ id: alice.id, name: 'Alice Souza', email: alice.email, role: 'OWNER', organizationId: alice.organizationId, organization: { name: 'Org Alice' } });
    expect(response.body).not.toMatch(/passwordHash|tokenHash/);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: alice.cookie } });
    expect(me.json().user.name).toBe('Alice Souza');
  });

  it.each([
    ['empty name', { name: '' }],
    ['blank name', { name: '   ' }],
    ['one character', { name: 'A' }],
    ['over 120 characters', { name: 'a'.repeat(121) }],
    ['non-string name', { name: 123 }],
    ['null name', { name: null }],
    ['missing name', {}],
  ])('rejects %s without changing the profile', async (_label, payload) => {
    const alice = await account('Alice');
    const response = await patch(alice.cookie, payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe('Invalid profile data');
    expect(stored(alice.id).name).toBe('Alice');
  });

  it('rejects a missing request body', async () => {
    const alice = await account('Alice');
    const response = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie: alice.cookie } });
    expect(response.statusCode).toBe(400);
    expect(stored(alice.id).name).toBe('Alice');
  });

  it.each([
    ['email', { email: 'attacker@example.com' }],
    ['role', { role: 'ADMIN' }],
    ['organizationId', { organizationId: 'organization-999' }],
    ['id', { id: 'user-999' }],
    ['userId', { userId: 'user-999' }],
    ['passwordHash', { passwordHash: 'x' }],
    ['password', { password: 'NewPass123' }],
    ['organization', { organization: { name: 'Hacked' } }],
  ])('rejects protected field %s even together with a valid name', async (_label, extra) => {
    const alice = await account('Alice');
    const before = JSON.stringify(stored(alice.id));
    const response = await patch(alice.cookie, { name: 'Renamed', ...extra });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(stored(alice.id))).toBe(before);
    expect(stored(alice.id).passwordHash).toMatch(/^\$2/);
  });

  it('requires authentication', async () => {
    const alice = await account('Alice');
    const anonymous = await patch(undefined, { name: 'Intruder' });
    const forged = await patch('serviceflow_session=invalid', { name: 'Intruder' });
    expect(anonymous.statusCode).toBe(401);
    expect(forged.statusCode).toBe(401);
    expect(stored(alice.id).name).toBe('Alice');
  });

  it('rejects a revoked session', async () => {
    const alice = await account('Alice');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: alice.cookie } });
    const response = await patch(alice.cookie, { name: 'After Logout' });
    expect(response.statusCode).toBe(401);
    expect(stored(alice.id).name).toBe('Alice');
  });

  it("changes only the caller's own record and ignores another user's id in the URL", async () => {
    const alice = await account('Alice');
    const bruno = await account('Bruno');

    const bodyAttack = await patch(alice.cookie, { name: 'Pwned', id: bruno.id, userId: bruno.id });
    const queryAttack = await patch(alice.cookie, { name: 'Alice Nova' }, `/api/auth/me?id=${bruno.id}&organizationId=${bruno.organizationId}`);

    expect(bodyAttack.statusCode).toBe(400);
    expect(queryAttack.statusCode).toBe(200);
    expect(queryAttack.json().user.id).toBe(alice.id);
    expect(stored(alice.id).name).toBe('Alice Nova');
    expect(stored(bruno.id).name).toBe('Bruno');
    const brunoMe = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: bruno.cookie } });
    expect(brunoMe.json().user).toMatchObject({ id: bruno.id, name: 'Bruno', email: bruno.email });
  });

  it('does not expose a way to read or edit another user through the API', async () => {
    const alice = await account('Alice');
    const bruno = await account('Bruno');
    for (const method of ['GET', 'PATCH'] as const) {
      const response = await app.inject({ method, url: `/api/auth/users/${bruno.id}`, headers: { cookie: alice.cookie }, ...(method === 'PATCH' ? { payload: { name: 'x' } } : {}) });
      expect(response.statusCode).toBe(404);
    }
    expect(stored(bruno.id).name).toBe('Bruno');
  });
});

describe('PrismaAuthRepository.updateUserName', () => {
  function fakeDb(count: number) {
    const calls: Array<{ where: unknown; data: unknown }> = [];
    const db = { user: { updateMany: async (args: { where: unknown; data: unknown }) => { calls.push(args); return { count }; }, findUnique: async () => ({ id: 'user-1', name: 'New', organization: {} }) } } as unknown as PrismaClient;
    return { db, calls };
  }

  it('scopes the update by user id and organization and writes only the name', async () => {
    const { db, calls } = fakeDb(1);
    await new PrismaAuthRepository(db).updateUserName('user-1', 'organization-1', 'New');
    expect(calls).toEqual([{ where: { id: 'user-1', organizationId: 'organization-1' }, data: { name: 'New' } }]);
  });

  it('returns null when the user does not belong to the organization', async () => {
    const { db } = fakeDb(0);
    expect(await new PrismaAuthRepository(db).updateUserName('user-1', 'other-organization', 'New')).toBeNull();
  });
});
