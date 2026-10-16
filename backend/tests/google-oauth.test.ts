import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
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
  async updateUserName(id: string, organizationId: string, name: string): Promise<AuthUserRecord | null> { const user = this.users.find((candidate) => candidate.id === id && candidate.organizationId === organizationId); if (!user) return null; user.name = name; return user; }

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

  it('preserves a valid internal destination through the OAuth callback', async () => {
    exchangeCodeForIdentity.mockResolvedValueOnce({
      providerAccountId: 'google-return-to',
      email: 'return-to@example.com',
      name: 'Return To User',
    });

    const start = await app.inject({ method: 'GET', url: '/api/auth/google?returnTo=%2Fcustomers%2Fnew' });
    const startCookies = String(start.headers['set-cookie']);
    const stateCookie = startCookies.match(/serviceflow_oauth_state=[^;]+/)?.[0];
    const returnToCookie = startCookies.match(/serviceflow_oauth_return_to=[^;]+/)?.[0];

    expect(start.statusCode).toBe(302);
    expect(returnToCookie).toContain('serviceflow_oauth_return_to=/customers/new');

    const callback = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=valid-code&state=oauth-state',
      headers: { cookie: `${stateCookie?.replace(/^[^=]+=[^;]+/, 'serviceflow_oauth_state=oauth-state')}; ${returnToCookie}` },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('https://serviceflow-wine-seven.vercel.app/customers/new');
  });

  it('falls back to the dashboard for invalid external destinations', async () => {
    exchangeCodeForIdentity.mockResolvedValueOnce({
      providerAccountId: 'google-invalid-return-to',
      email: 'invalid-return-to@example.com',
      name: 'Invalid Return To User',
    });

    const start = await app.inject({ method: 'GET', url: '/api/auth/google?returnTo=https%3A%2F%2Fevil.example' });
    const startCookies = String(start.headers['set-cookie']);
    const stateCookie = startCookies.match(/serviceflow_oauth_state=[^;]+/)?.[0];
    const callback = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=valid-code&state=oauth-state-invalid',
      headers: { cookie: stateCookie?.replace(/^[^=]+=[^;]+/, 'serviceflow_oauth_state=oauth-state-invalid') },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('https://serviceflow-wine-seven.vercel.app/dashboard');
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

  describe('account linking is never automatic', () => {
    const failure = 'https://serviceflow-wine-seven.vercel.app/login?error=oauth_unlinked';
    let sequence = 0;
    const callback = async (identity: { providerAccountId: string; email: string; name: string }) => {
      exchangeCodeForIdentity.mockResolvedValueOnce(identity);
      const state = `link-state-${++sequence}`;
      return app.inject({ method: 'GET', url: `/api/auth/google/callback?code=valid-code&state=${state}`, cookies: { serviceflow_oauth_state: state } });
    };
    const sessionCookieOf = (response: { headers: Record<string, unknown> }) =>
      String(response.headers['set-cookie'] ?? '').split(/,(?=[^;]+=)/).map((value) => value.trim().split(';')[0] ?? '').find((value) => value.startsWith('serviceflow_session=') && value.length > 'serviceflow_session='.length);
    const snapshot = (email: string) => repository.findUsersByEmail(email).then((users) => JSON.stringify(users));

    it('rejects a Google sign-in whose e-mail matches a local account that is not linked, changing nothing', async () => {
      const local = repository.seedUser({ name: 'Existing', email: 'existing@example.com', passwordHash: 'hashed-value' });
      const before = await snapshot('existing@example.com');

      const response = await callback({ providerAccountId: 'google-999', email: 'existing@example.com', name: 'Existing' });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(failure);
      expect(sessionCookieOf(response)).toBeUndefined();
      expect(await repository.findUserByOAuthAccount('google', 'google-999')).toBeNull();
      expect(await snapshot('existing@example.com')).toBe(before);
      expect((await repository.findUsersByEmail('existing@example.com'))).toHaveLength(1);
      expect(local.passwordHash).toBe('hashed-value');
    });

    it('does not reveal the registered e-mail or the existing organization in the redirect', async () => {
      repository.seedUser({ name: 'Existing', email: 'private@example.com', passwordHash: 'hashed-value' });
      const response = await callback({ providerAccountId: 'google-private', email: 'private@example.com', name: 'Someone' });

      const location = String(response.headers.location);
      expect(location).not.toContain('private');
      expect(location).not.toContain('Seed Org');
      expect(location).not.toContain('example.com');
      expect(String(response.body)).not.toContain('private@example.com');
    });

    it('keeps an attacker who registered the victim e-mail out of the victim flow and the victim out of the attacker organization', async () => {
      const passwordHash = await bcrypt.hash('AttackerPass1', 4);
      const attacker = repository.seedUser({ name: 'Attacker', email: 'victim@example.com', passwordHash });

      const first = await callback({ providerAccountId: 'google-victim', email: 'victim@example.com', name: 'Victim' });
      const retry = await callback({ providerAccountId: 'google-victim', email: 'victim@example.com', name: 'Victim' });

      expect([first.headers.location, retry.headers.location]).toEqual([failure, failure]);
      expect(sessionCookieOf(first)).toBeUndefined();
      expect(sessionCookieOf(retry)).toBeUndefined();
      expect(await repository.findUserByOAuthAccount('google', 'google-victim')).toBeNull();
      // Nenhuma organizacao nova e a conta do atacante segue sem nenhuma identidade Google ligada.
      expect((await repository.findUsersByEmail('victim@example.com')).map((user) => user.organizationId)).toEqual([attacker.organizationId]);

      // O login por senha do dono da conta local continua funcionando e a conta permanece com a organizacao original.
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'victim@example.com', password: 'AttackerPass1' } });
      expect(login.statusCode).toBe(200);
      expect(login.json().user.organizationId).toBe(attacker.organizationId);
      const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'victim@example.com', password: 'WrongPass1' } });
      expect(wrong.statusCode).toBe(401);
    });

    it('rejects an e-mail already used by an account created through another Google identity', async () => {
      const created = await callback({ providerAccountId: 'google-first-owner', email: 'shared@example.com', name: 'First Owner' });
      expect(created.statusCode).toBe(302);
      expect(sessionCookieOf(created)).toBeDefined();

      const other = await callback({ providerAccountId: 'google-second-identity', email: 'shared@example.com', name: 'Second' });

      expect(other.headers.location).toBe(failure);
      expect(sessionCookieOf(other)).toBeUndefined();
      expect(await repository.findUserByOAuthAccount('google', 'google-second-identity')).toBeNull();
      expect((await repository.findUsersByEmail('shared@example.com'))).toHaveLength(1);
    });

    it('keeps working for an identity that is already linked, even when the Google e-mail changed', async () => {
      const local = repository.seedUser({ name: 'Linked', email: 'linked@example.com', passwordHash: 'hashed-value' });
      await repository.linkOAuthAccount({ provider: 'google', providerAccountId: 'google-linked', userId: local.id, organizationId: local.organizationId });

      const same = await callback({ providerAccountId: 'google-linked', email: 'linked@example.com', name: 'Linked' });
      const changed = await callback({ providerAccountId: 'google-linked', email: 'new-address@example.com', name: 'Linked' });

      for (const response of [same, changed]) {
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe('https://serviceflow-wine-seven.vercel.app/dashboard');
        const cookie = sessionCookieOf(response) as string;
        expect(cookie).toBeDefined();
        const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
        expect(me.json().user).toMatchObject({ id: local.id, organizationId: local.organizationId, email: 'linked@example.com' });
      }
      expect(local.passwordHash).toBe('hashed-value');
    });

    it('still creates a new Google account (and organization) when no account uses the e-mail', async () => {
      const response = await callback({ providerAccountId: 'google-brand-new', email: 'brand-new@example.com', name: 'Brand New' });

      expect(response.headers.location).toBe('https://serviceflow-wine-seven.vercel.app/dashboard');
      const cookie = sessionCookieOf(response) as string;
      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(me.json().user).toMatchObject({ email: 'brand-new@example.com', role: 'OWNER' });
      expect(me.json().user.organization.name).toBe('Brand New (Google)');
      expect((await repository.findUserByOAuthAccount('google', 'google-brand-new'))?.email).toBe('brand-new@example.com');
    });

    it('does not break the other failure paths: bad state and failed exchanges keep the generic reason', async () => {
      const badState = await app.inject({ method: 'GET', url: '/api/auth/google/callback?code=x&state=other', cookies: { serviceflow_oauth_state: 'expected' } });
      expect(badState.headers.location).toBe('https://serviceflow-wine-seven.vercel.app/login?error=oauth');
      exchangeCodeForIdentity.mockRejectedValueOnce(new Error('unverified'));
      const failed = await app.inject({ method: 'GET', url: '/api/auth/google/callback?code=x&state=s', cookies: { serviceflow_oauth_state: 's' } });
      expect(failed.headers.location).toBe('https://serviceflow-wine-seven.vercel.app/login?error=oauth');
    });
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
