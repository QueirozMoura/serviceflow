import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthUserRecord } from '../src/modules/auth/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
// Limites padrao (sem AUTH_RATE_LIMIT_MAX): recuperar 5/min, validar 20/min, redefinir 10/min.

const { buildApp } = await import('../src/app.js');
const { authenticateAccount } = await import('../src/modules/auth/service.js');
const { MailDeliveryError, ResendMailer, createMailer, DisabledMailer, OutboxMailer } = await import('../src/modules/mail/mailer.js');
const { buildPasswordResetEmail } = await import('../src/modules/mail/templates.js');
import type { PasswordRecoveryService as RecoveryService } from '../src/modules/password-reset/service.js';

const token = 'A'.repeat(43);
const fakeService = (): RecoveryService => ({ start: () => undefined, idle: async () => undefined, validate: async () => false, reset: async () => 'invalid' } as unknown as RecoveryService);

describe('password recovery endpoints are rate limited per route', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ passwordRecovery: fakeService() }); await app.ready(); });
  afterEach(async () => { await app.close(); });

  const run = async (url: string, payload: object, count: number) => {
    const out: number[] = [];
    for (let attempt = 0; attempt < count; attempt += 1) out.push((await app.inject({ method: 'POST', url, payload })).statusCode);
    return out;
  };

  it('limits recovery requests to 5 per minute', async () => {
    const result = await run('/api/auth/password/forgot', { email: 'a@example.com' }, 7);
    expect(result).toEqual([202, 202, 202, 202, 202, 429, 429]);
  });

  it('limits token validation to 20 per minute and password changes to 10 per minute, independently', async () => {
    const validations = await run('/api/auth/password/validate', { token }, 22);
    expect(validations.slice(0, 20)).toEqual(Array(20).fill(404));
    expect(validations.slice(20)).toEqual([429, 429]);
    const resets = await run('/api/auth/password/reset', { token, password: 'StrongPass1' }, 12);
    expect(resets.slice(0, 10)).toEqual(Array(10).fill(404));
    expect(resets.slice(10)).toEqual([429, 429]);
  });

  it('answers the generic recovery message with no token, link or recipient detail', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'someone@example.com' } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ message: 'If an account exists for this e-mail, recovery instructions will be sent' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toMatch(/someone|token|reset-password/i);
  });
});

describe('Resend mailer', () => {
  const message = { to: 'ana@example.com', subject: 'Assunto', text: 'corpo https://app/x#t=SECRETTOKEN', html: '<p>corpo</p>' };

  it('posts the message to the Resend API authenticated by the API key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    await new ResendMailer('re_test_key', 'ServiceFlow <no-reply@example.com>', 5000, fetchMock).send(message);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(String(init?.body))).toEqual({ from: 'ServiceFlow <no-reply@example.com>', to: ['ana@example.com'], subject: 'Assunto', text: message.text, html: message.html });
  });

  it('turns provider refusals and network failures into a delivery error without leaking the key, recipient or body', async () => {
    const refused = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"to":"ana@example.com","error":"SECRETTOKEN"}', { status: 422 }));
    const unreachable = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed: re_test_key ana@example.com'));
    for (const fetchImpl of [refused, unreachable]) {
      const error = await new ResendMailer('re_test_key', 'from@example.com', 5000, fetchImpl).send(message).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(MailDeliveryError);
      expect(String((error as Error).message)).not.toMatch(/re_test_key|ana@example\.com|SECRETTOKEN/);
    }
    await expect(new ResendMailer('k', 'f@example.com', 5000, refused).send(message)).rejects.toThrow('status 422');
  });

  it('picks the mailer from the configuration and never falls back to sending', () => {
    expect(createMailer({})).toBeInstanceOf(DisabledMailer);
    expect(createMailer({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' })).toBeInstanceOf(DisabledMailer);
    expect(createMailer({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'f@example.com' })).toBeInstanceOf(ResendMailer);
    expect(createMailer({ MAIL_PROVIDER: 'outbox' })).toBeInstanceOf(OutboxMailer);
    expect(new DisabledMailer().enabled).toBe(false);
  });

  it('escapes the user-controlled fields in the HTML body and keeps the link in the plain text', () => {
    const built = buildPasswordResetEmail({ to: 'a@example.com', name: '<b>Ana</b>', organizationName: 'A & B "Cia"', link: 'https://app.example.com/reset-password#t=abc', validForMinutes: 30 });
    expect(built.html).not.toContain('<b>Ana</b>');
    expect(built.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(built.html).toContain('A &amp; B &quot;Cia&quot;');
    expect(built.text).toContain('https://app.example.com/reset-password#t=abc');
    expect(built.text).toContain('30 minutos');
  });
});

describe('mail configuration is validated when the server starts', () => {
  const saved = { ...process.env };
  afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); vi.resetModules(); });

  const load = async (overrides: Record<string, string | undefined>) => {
    vi.resetModules();
    const base = { NODE_ENV: 'development', MAIL_PROVIDER: undefined, RESEND_API_KEY: undefined, MAIL_FROM: undefined, ...overrides };
    for (const [key, value] of Object.entries(base)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    return import('../src/config/env.js');
  };
  const production = { NODE_ENV: 'production', HOST: '0.0.0.0', CORS_ORIGIN: 'https://app.example.com' };

  it('refuses the in-memory outbox in production and accepts it outside production', async () => {
    await expect(load({ ...production, MAIL_PROVIDER: 'outbox' })).rejects.toThrow('Invalid environment configuration');
    expect((await load({ MAIL_PROVIDER: 'outbox' })).env.MAIL_PROVIDER).toBe('outbox');
  });

  it('requires the API key and the sender address for Resend', async () => {
    await expect(load({ MAIL_PROVIDER: 'resend' })).rejects.toThrow('Invalid environment configuration');
    await expect(load({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' })).rejects.toThrow('Invalid environment configuration');
    expect((await load({ ...production, MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'ServiceFlow <no-reply@example.com>' })).env.MAIL_PROVIDER).toBe('resend');
  });

  it('still starts in production without any mail provider (recovery is then inoperative, never insecure)', async () => {
    expect((await load(production)).env.MAIL_PROVIDER).toBeUndefined();
  });
});

describe('login spends the same bcrypt work whether or not the account exists', () => {
  const user = (id: string, passwordHash: string | null): AuthUserRecord => ({ id, organizationId: `org-${id}`, name: id, email: 'a@example.com', passwordHash, role: UserRole.OWNER, organization: { id: `org-${id}`, name: id, slug: id } });
  const repo = (users: AuthUserRecord[]): AuthRepository => ({ findUsersByEmail: async () => users } as unknown as AuthRepository);

  it('runs exactly one comparison for an unknown e-mail, a Google-only account and a wrong password', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    const real = await bcrypt.hash('RightPass1', 4);
    const runs: Array<[string, AuthUserRecord[]]> = [['unknown', []], ['google-only', [user('g', null)]], ['wrong password', [user('p', real)]]];
    for (const [label, users] of runs) {
      spy.mockClear();
      expect(await authenticateAccount(repo(users), { email: 'a@example.com', password: 'WrongPass1' }), label).toBeNull();
      expect(spy, label).toHaveBeenCalledTimes(1);
    }
    spy.mockClear();
    await authenticateAccount(repo([user('1', real), user('2', null)]), { email: 'a@example.com', password: 'x' });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('uses a full-cost (12) dummy hash and still never authenticates without a local password', async () => {
    const compared: string[] = [];
    const spy = vi.spyOn(bcrypt, 'compare').mockImplementation(async (_plain, hash) => { compared.push(String(hash)); return true; });
    // Mesmo que a comparacao "passe", sem senha local ninguem entra.
    expect(await authenticateAccount(repo([]), { email: 'a@example.com', password: 'x' })).toBeNull();
    expect(await authenticateAccount(repo([user('g', null)]), { email: 'a@example.com', password: 'x' })).toBeNull();
    expect(compared).toHaveLength(2);
    expect(compared.every((hash) => hash.startsWith('$2b$12$'))).toBe(true);
    spy.mockRestore();
  });

  it('keeps authenticating a real account with the right password', async () => {
    const real = await bcrypt.hash('RightPass1', 4);
    const account = user('ok', real);
    expect((await authenticateAccount(repo([account]), { email: 'a@example.com', password: 'RightPass1' }))?.id).toBe('ok');
  });
});
