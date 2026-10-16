import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas). Nada aqui toca o banco de desenvolvimento.
const temporary: TemporaryDatabase = createTemporaryDatabase('google');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://api.example.com/api/auth/google/callback';
process.env.OAUTH_SUCCESS_REDIRECT = 'https://app.example.com/dashboard';
process.env.OAUTH_FAILURE_REDIRECT = 'https://app.example.com/login';

// Somente a troca de codigo com o Google e simulada; resolveGoogleUser, repositorio e rotas sao os reais.
const exchangeCodeForIdentity = vi.hoisted(() => vi.fn());
vi.mock('../../src/modules/auth/google.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/modules/auth/google.js')>()), exchangeCodeForIdentity }));

const { buildApp } = await import('../../src/app.js');
const { prisma } = await import('../../src/lib/prisma.js');

describe('Google sign-in never links to an existing account by e-mail (real PostgreSQL)', () => {
  const db: PrismaClient = prisma;
  let app: FastifyInstance;
  let sequence = 0;

  beforeAll(async () => { app = buildApp(); await app.ready(); }, 120_000);
  afterAll(async () => { await app?.close(); await db.$disconnect(); temporary.drop(); }, 60_000);

  const register = (organizationName: string, email: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName, name: `Dono ${organizationName}`, email, password } });
  const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const google = async (identity: { providerAccountId: string; email: string; name: string }) => {
    exchangeCodeForIdentity.mockResolvedValueOnce(identity);
    const state = `state-${++sequence}`;
    return app.inject({ method: 'GET', url: `/api/auth/google/callback?code=code&state=${state}`, cookies: { serviceflow_oauth_state: state } });
  };
  const sessionCookie = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie'] ?? '').split(/,(?=[^;]+=)/).map((value) => value.trim().split(';')[0] ?? '').find((value) => value.startsWith('serviceflow_session=') && value.length > 20);
  const counts = async () => ({ organizations: await db.organization.count(), users: await db.user.count(), oauthAccounts: await db.oAuthAccount.count(), sessions: await db.session.count() });
  const rows = async () => JSON.stringify({ organizations: await db.organization.findMany({ orderBy: { id: 'asc' } }), users: await db.user.findMany({ orderBy: { id: 'asc' } }), oauth: await db.oAuthAccount.findMany({ orderBy: { id: 'asc' } }) });

  it('keeps the attacker\'s account untouched and gives the victim no access to it', async () => {
    expect((await register('Atacante Ltda', 'vitima@gmail.test', 'SenhaDoAtacante1')).statusCode).toBe(201);
    const before = await rows();
    const countsBefore = await counts();

    const attempt = await google({ providerAccountId: 'google-sub-da-vitima', email: 'vitima@gmail.test', name: 'Vitima Real' });
    const retry = await google({ providerAccountId: 'google-sub-da-vitima', email: 'vitima@gmail.test', name: 'Vitima Real' });

    for (const response of [attempt, retry]) {
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://app.example.com/login?error=oauth_unlinked');
      expect(sessionCookie(response)).toBeUndefined();
      expect(String(response.headers.location)).not.toMatch(/vitima|gmail|Atacante/i);
    }
    expect(await rows()).toBe(before);
    expect(await counts()).toEqual(countsBefore);
    expect(await db.oAuthAccount.count({ where: { providerAccountId: 'google-sub-da-vitima' } })).toBe(0);
    const stored = await db.user.findFirstOrThrow({ where: { email: 'vitima@gmail.test' } });
    expect(stored.passwordHash).toMatch(/^\$2/);
  });

  it('keeps password login working for the local account after the rejected attempts', async () => {
    const ok = await login('vitima@gmail.test', 'SenhaDoAtacante1');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe('vitima@gmail.test');
    expect((await login('vitima@gmail.test', 'OutraSenha1')).statusCode).toBe(401);
  });

  it('creates a Google account only for an e-mail nobody uses, and keeps returning to the same organization', async () => {
    const before = await counts();
    const created = await google({ providerAccountId: 'google-sub-novo', email: 'novo@gmail.test', name: 'Novo Usuario' });

    expect(created.headers.location).toBe('https://app.example.com/dashboard');
    const cookie = sessionCookie(created) as string;
    expect(cookie).toBeDefined();
    expect(await counts()).toEqual({ organizations: before.organizations + 1, users: before.users + 1, oauthAccounts: before.oauthAccounts + 1, sessions: before.sessions + 1 });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user).toMatchObject({ email: 'novo@gmail.test', role: 'OWNER' });
    const owner = await db.user.findFirstOrThrow({ where: { email: 'novo@gmail.test' } });
    expect(owner.passwordHash).toBeNull();

    const returning = await google({ providerAccountId: 'google-sub-novo', email: 'novo@gmail.test', name: 'Novo Usuario' });
    expect(returning.headers.location).toBe('https://app.example.com/dashboard');
    const second = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie(returning) as string } });
    expect(second.json().user.organizationId).toBe(owner.organizationId);
    expect((await counts()).organizations).toBe(before.organizations + 1);
  });

  it('keeps an already linked identity working when the Google e-mail changes', async () => {
    const owner = await db.user.findFirstOrThrow({ where: { email: 'novo@gmail.test' } });
    const before = await counts();
    const response = await google({ providerAccountId: 'google-sub-novo', email: 'endereco-novo@gmail.test', name: 'Novo Usuario' });

    expect(response.headers.location).toBe('https://app.example.com/dashboard');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie(response) as string } });
    expect(me.json().user).toMatchObject({ id: owner.id, organizationId: owner.organizationId, email: 'novo@gmail.test' });
    const after = await counts();
    expect({ ...after, sessions: before.sessions }).toEqual(before);
  });

  it('does not let a later password sign-up with a Google user\'s e-mail take over that Google identity', async () => {
    const googleOwner = await db.user.findFirstOrThrow({ where: { email: 'novo@gmail.test' } });
    const impostor = await register('Impostor SA', 'novo@gmail.test', 'SenhaDoImpostor1');
    expect(impostor.statusCode).toBe(201);
    const impostorOrganization = impostor.json().organization.id as string;

    const response = await google({ providerAccountId: 'google-sub-novo', email: 'novo@gmail.test', name: 'Novo Usuario' });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie(response) as string } });

    expect(me.json().user.id).toBe(googleOwner.id);
    expect(me.json().user.organizationId).toBe(googleOwner.organizationId);
    expect(me.json().user.organizationId).not.toBe(impostorOrganization);
  });

  it('rejects a second Google identity that claims an e-mail already owned by a Google account', async () => {
    const before = await rows();
    const response = await google({ providerAccountId: 'google-sub-outro', email: 'novo@gmail.test', name: 'Outro' });

    expect(response.headers.location).toBe('https://app.example.com/login?error=oauth_unlinked');
    expect(sessionCookie(response)).toBeUndefined();
    expect(await rows()).toBe(before);
  });
});
