import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const { buildApp } = await import('../src/app.js');

class MemoryAuthRepository implements AuthRepository {
  private organizations: CreatedAccount['organization'][] = [];
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
    if (this.organizations.some((organization) => organization.slug === input.slug)) {
      throw { code: 'P2002' };
    }

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
    this.organizations.push(organization);
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

describe('authentication routes', () => {
  let app: FastifyInstance;
  let repository: MemoryAuthRepository;

  beforeEach(async () => {
    repository = new MemoryAuthRepository();
    app = buildApp({ authRepository: repository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function register() {
    return app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'ServiceFlow Labs',
        name: 'Owner User',
        email: 'OWNER@EXAMPLE.COM',
        password: 'StrongPass1',
      },
    });
  }

  async function login() {
    return app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.com', password: 'StrongPass1' },
    });
  }

  it('registers an organization and owner without exposing the password hash', async () => {
    const response = await register();
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.user.role).toBe('OWNER');
    expect(body.user.email).toBe('owner@example.com');
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    expect(JSON.stringify(body)).not.toContain('StrongPass1');
  });

  it('rejects invalid email and weak password during registration', async () => {
    const invalidEmail = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: 'Acme', name: 'Owner', email: 'invalid', password: 'StrongPass1' } });
    const weakPassword = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: 'Other', name: 'Owner', email: 'owner@example.com', password: 'weak' } });

    expect(invalidEmail.statusCode).toBe(400);
    expect(weakPassword.statusCode).toBe(400);
  });

  it('rejects a duplicate organization registration generically', async () => {
    await register();
    const response = await register();

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe('Unable to create account');
  });

  it('logs in with normalized credentials and sets an HttpOnly session cookie', async () => {
    await register();
    const response = await login();

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.json().user.email).toBe('owner@example.com');
    expect(JSON.stringify(response.json())).not.toContain('passwordHash');
  });

  it('uses a generic response for an incorrect password', async () => {
    await register();
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@example.com', password: 'WrongPass1' } });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe('Invalid email or password');
  });

  it('returns the authenticated user and organization without secrets', async () => {
    await register();
    const loginResponse = await login();
    const sessionCookie = String(loginResponse.headers['set-cookie']).split(';')[0];
    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.organization.name).toBe('ServiceFlow Labs');
    expect(JSON.stringify(response.json())).not.toContain('passwordHash');
  });

  it('rejects unauthenticated access to the current user', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(response.statusCode).toBe(401);
  });

  it('revokes the current session and remains safe when logged out twice', async () => {
    await register();
    const loginResponse = await login();
    const sessionCookie = String(loginResponse.headers['set-cookie']).split(';')[0];
    const firstLogout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: sessionCookie } });
    const secondLogout = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    const currentUser = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie } });

    expect(firstLogout.statusCode).toBe(204);
    expect(secondLogout.statusCode).toBe(204);
    expect(currentUser.statusCode).toBe(401);
  });

  it('stores a bcrypt hash instead of the submitted password', async () => {
    await register();
    const user = await repository.findUsersByEmail('owner@example.com');

    expect(user).toHaveLength(1);
    expect(user[0]?.passwordHash).not.toBe('StrongPass1');
    expect(await bcrypt.compare('StrongPass1', user[0]?.passwordHash ?? '')).toBe(true);
  });
});