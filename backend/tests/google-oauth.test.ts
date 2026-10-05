import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type {
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord,
  CreatedAccount,
} from '../src/modules/auth/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://serviceflow-15yc.onrender.com/api/auth/google/callback';
process.env.OAUTH_SUCCESS_REDIRECT = 'https://serviceflow-wine-seven.vercel.app/dashboard';
process.env.OAUTH_FAILURE_REDIRECT = 'https://serviceflow-wine-seven.vercel.app/login';

const exchangeCodeForIdentity = vi.fn();

vi.mock('../src/modules/auth/google.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/auth/google.js')>();
  return { ...actual, exchangeCodeForIdentity };
});

const { buildApp } = await import('../src/app.js');

class MemoryAuthRepository implements AuthRepository {
  private users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord & { revokedAt?: Date }>();
  private oauthAccounts = new Map<string, { userId: string; organizationId: string }>();
  private sequence = 0;

  async createOrganizationWithOwner(input: {
    organizationName: string;
    slug: string;
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<CreatedAccount> {
    const id = String(++this.sequence);
    const organization = {
      id: `organization-${id}`,
      name: input.organizationName,
      slug: input.slug,
    };
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

  async createSession(input: {
    tokenHash: string;
    userId: string;
    organizationId: string;
    expiresAt: Date;
  }): Promise<void> {
    const user = this.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error('User not found');
    this.sessions.set(input.tokenHash, {
      expiresAt: input.expiresAt,
      user: { id: user.id, organizationId: user.organizationId, role: user.role },
    });
  }

  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    const session = this.sessions.get(tokenHash);
    return Promise.resolve(session && !session.revokedAt ? session : null);
  }

  async revokeSession(tokenHash: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = new Date();
  }

  findUserByOAuthAccount(
    provider: string,
    providerAccountId: string,
  ): Promise<AuthUserRecord | null> {
    const link = this.oauthAccounts.get(`${provider}:${providerAccountId}`);
    if (!link) return Promise.resolve(null);
    return Promise.resolve(this.users.find((user) => user.id === link.userId) ?? null);
  }

  async linkOAuthAccount(input: {
    provider: string;
    providerAccountId: string;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    this.oauthAccounts.set(`${input.provider}:${input.providerAccountId}`, {
      userId: input.userId,
      organizationId: input.organizationId,
    });
  }

  async createOrganizationWithOAuthUser(input: {
    organizationName: string;
    slug: string;
    name: string;
    email: string;
    provider: string;
    providerAccountId: string;
  }): Promise<CreatedAccount> {
    const id = String(++this.sequence);
    const organization = {
      id: `organization-${id}`,
      name: input.organizationName,
      slug: input.slug,
    };
    const user: AuthUserRecord = {
      id: `user-${id}`,
      organizationId: organization.id,
      name: input.name,
      email: input.email,
      passwordHash: null,
      role: UserRole.OWNER,
      organization,
    };
    this.users.push(user);
    await this.linkOAuthAccount({
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      userId: user.id,
      organizationId: organization.id,
    });
    return { user, organization };
  }

  seedUser(input: { name: string; email: string; passwordHash: string }): AuthUserRecord {
    const id = String(++this.sequence);
    const organization = { id: `organization-${id}`, name: 'Seed Org', slug: `seed-${id}` };
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
    return user;
  }
}

describe('google oauth routes', () => {
  let app: FastifyInstance;
  let repository: MemoryAuthRepository;

  beforeAll(() => {
    repository = new MemoryAuthRepository();
    app = buildApp({ authRepository: repository });
  });

  beforeEach(async () => {
    exchangeCodeForIdentity.mockReset();
    if (!app.server.listening) await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('redirects to Google with state and an HttpOnly state cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/google' });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location as string;
    expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    expect(location).toContain(
      'redirect_uri=https%3A%2F%2Fserviceflow-15yc.onrender.com%2Fapi%2Fauth%2Fgoogle%2Fcallback',
    );
    expect(location).toContain('scope=openid+email+profile');
    expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('rejects the callback when the state does not match', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=abc&state=forged',
      cookies: { serviceflow_oauth_state: 'expected' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      'https://serviceflow-wine-seven.vercel.app/login?error=oauth',
    );
    expect(exchangeCodeForIdentity).not.toHaveBeenCalled();
  });

  it('creates a Google user without a password, sets the session cookie and redirects to the frontend', async () => {
    exchangeCodeForIdentity.mockResolvedValueOnce({
      providerAccountId: 'google-123',
      email: 'user@example.com',
      name: 'Google User',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=valid-code&state=ok-state',
      cookies: { serviceflow_oauth_state: 'ok-state' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://serviceflow-wine-seven.vercel.app/dashboard');
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('serviceflow_session');

    // O callback tambem limpa o cookie de state; seleciona o cookie de sessao.
    const sessionCookie = setCookie
      .split(/,(?=[^;]+=)/)
      .map((value) => value.trim().split(';')[0] ?? '')
      .find((value) => value.startsWith('serviceflow_session=')) as string;
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('user@example.com');
    expect(me.json().user.passwordHash).toBeUndefined();

    const stored = await repository.findUsersByEmail('user@example.com');
    expect(stored[0]?.passwordHash).toBeNull();
  });

  it('links a Google identity to an existing email/password account', async () => {
    repository.seedUser({
      name: 'Existing',
      email: 'existing@example.com',
      passwordHash: 'hashed-value',
    });
    exchangeCodeForIdentity.mockResolvedValueOnce({
      providerAccountId: 'google-999',
      email: 'existing@example.com',
      name: 'Existing',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=valid-code&state=ok-state-2',
      cookies: { serviceflow_oauth_state: 'ok-state-2' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://serviceflow-wine-seven.vercel.app/dashboard');

    const users = await repository.findUsersByEmail('existing@example.com');
    expect(users).toHaveLength(1);
    // A senha original permanece intacta; o login por email/senha segue valido.
    expect(users[0]?.passwordHash).toBe('hashed-value');
    expect(await repository.findUserByOAuthAccount('google', 'google-999')).not.toBeNull();
  });

  it('redirects to the failure URL when the token exchange throws', async () => {
    exchangeCodeForIdentity.mockRejectedValueOnce(new Error('boom'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=bad&state=ok-state-3',
      cookies: { serviceflow_oauth_state: 'ok-state-3' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      'https://serviceflow-wine-seven.vercel.app/login?error=oauth',
    );
  });
});
