import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';
import type { MailMessage, Mailer } from '../../src/modules/mail/mailer.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas, incluindo PasswordResetToken). Corridas = app.inject em
// Promise.all contra o pool real do Prisma. O provedor de e-mail e substituido por uma caixa de saida em memoria.
const temporary: TemporaryDatabase = createTemporaryDatabase('pwreset');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { PrismaPasswordResetRepository } = await import('../../src/modules/password-reset/repository.js');
const { PasswordRecoveryService } = await import('../../src/modules/password-reset/service.js');
const { MailDeliveryError, DisabledMailer, OutboxMailer } = await import('../../src/modules/mail/mailer.js');
const { hashResetToken } = await import('../../src/modules/password-reset/tokens.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { resolveGoogleUser, GoogleAccountNotLinkedError } = await import('../../src/modules/auth/service.js');
const { env } = await import('../../src/config/env.js');

class TestMailer implements Mailer {
  enabled = true;
  messages: MailMessage[] = [];
  failNext = 0;
  async send(message: MailMessage): Promise<void> {
    if (this.failNext > 0) { this.failNext -= 1; throw new MailDeliveryError('Mail provider responded with status 500'); }
    this.messages.push(message);
  }
}

describe('password recovery against a real PostgreSQL database', () => {
  let db: PrismaClient;
  let auth: InstanceType<typeof PrismaAuthRepository>;
  let app: FastifyInstance;
  let service: InstanceType<typeof PasswordRecoveryService>;
  const mailer = new TestMailer();
  const logs: string[] = [];
  let now = new Date();
  const base = 'https://app.example.com';

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: temporary.url } } });
    auth = new PrismaAuthRepository(db);
    service = new PasswordRecoveryService({ repository: new PrismaPasswordResetRepository(db), mailer, appBaseUrl: base, clock: () => now });
    const stream = new Writable({ write(chunk, _encoding, callback) { logs.push(String(chunk)); callback(); } });
    app = buildApp({ authRepository: auth, mailer, passwordRecovery: service, loggerStream: stream });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    temporary.drop();
  }, 60_000);

  const password = 'StrongPass1';
  let counter = 0;
  const unique = (label: string) => `${label}-${++counter}-${randomUUID().slice(0, 6)}`;
  const post = (url: string, payload?: object) => app.inject({ method: 'POST', url, ...(payload ? { payload } : {}) });
  const forgot = async (email: string) => { const response = await post('/api/auth/password/forgot', { email }); await service.idle(); return response; };
  const reset = (token: string, newPassword: string) => post('/api/auth/password/reset', { token, password: newPassword });
  const validate = (token: string) => post('/api/auth/password/validate', { token });
  const login = (email: string, pass: string) => post('/api/auth/login', { email, password: pass });
  const tokenFrom = (message: MailMessage) => /#t=([A-Za-z0-9_-]{43})/.exec(message.text)![1]!;
  /** Avanca o relogio alem do intervalo minimo entre e-mails da mesma conta. */
  const advance = (ms = 61_000) => { now = new Date(now.getTime() + ms); };

  async function account(options: { name?: string; email?: string } = {}) {
    const email = options.email ?? `${unique('user')}@example.com`;
    const { user } = await auth.createOrganizationWithOwner({ organizationName: options.name ?? `Org ${unique('o')}`, slug: unique('slug'), name: 'Dono', email, passwordHash: await bcrypt.hash(password, 4) });
    return { email, userId: user.id, organizationId: user.organizationId };
  }
  async function session(userId: string, organizationId: string) {
    const { token, tokenHash } = createSessionToken();
    await auth.createSession({ tokenHash, userId, organizationId, expiresAt: sessionExpiresAt() });
    return `${env.AUTH_COOKIE_NAME}=${token}`;
  }
  const me = (cookie: string) => app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  /** Pede a recuperacao e devolve o token recebido por e-mail (a caixa de saida e limpa antes). */
  async function requestToken(email: string) {
    mailer.messages = [];
    advance();
    expect((await forgot(email)).statusCode).toBe(202);
    expect(mailer.messages.length).toBeGreaterThan(0);
    return tokenFrom(mailer.messages[0]!);
  }

  describe('requesting recovery', () => {
    it('answers identically for a registered e-mail, an unknown one and a Google-only account, and only mails the registered one', async () => {
      const known = await account();
      const google = await db.organization.create({ data: { name: 'Org Google', slug: unique('g') } });
      const googleEmail = `${unique('google')}@example.com`;
      await db.user.create({ data: { organizationId: google.id, name: 'G', email: googleEmail, role: UserRole.OWNER, passwordHash: null } });
      mailer.messages = [];

      const [existing, unknown, googleOnly] = [await forgot(known.email), await forgot(`${unique('nobody')}@example.com`), await forgot(googleEmail)];
      for (const response of [unknown, googleOnly]) {
        expect(response.statusCode).toBe(existing.statusCode);
        expect(response.body).toBe(existing.body);
        expect(response.headers['cache-control']).toBe(existing.headers['cache-control']);
      }
      expect(existing.statusCode).toBe(202);
      expect(mailer.messages.map((message) => message.to)).toEqual([known.email]);
      expect(await db.passwordResetToken.count({ where: { organizationId: google.id } })).toBe(0);
      // Nem a resposta nem os cabecalhos carregam token ou link.
      expect(existing.body + JSON.stringify(existing.headers)).not.toMatch(/reset-password|[A-Za-z0-9_-]{43}/);
    });

    it('mails a link to the registered address only, stores just the token hash, and ignores any recipient sent by the client', async () => {
      const known = await account({ name: 'Oficina <Central>' });
      const other = await account();
      mailer.messages = []; advance();
      for (const extra of [{ to: other.email }, { userId: other.userId }, { organizationId: other.organizationId }]) {
        expect((await post('/api/auth/password/forgot', { email: known.email, ...extra })).statusCode, JSON.stringify(extra)).toBe(400);
      }
      expect((await post('/api/auth/password/forgot', { email: 'not-an-email' })).statusCode).toBe(400);
      expect((await post('/api/auth/password/forgot', {})).statusCode).toBe(400);
      await service.idle();
      expect(mailer.messages).toHaveLength(0);

      expect((await forgot(known.email)).statusCode).toBe(202);
      expect(mailer.messages).toHaveLength(1);
      const message = mailer.messages[0]!;
      expect(message.to).toBe(known.email);
      expect(message.text).toContain(`${base}/reset-password#t=`);
      expect(message.html).toContain('Oficina &lt;Central&gt;');
      expect(message.html).not.toContain('<Central>');
      const token = tokenFrom(message);
      const row = await db.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashResetToken(token) } });
      expect(row).toMatchObject({ userId: known.userId, organizationId: known.organizationId, usedAt: null });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(30 * 60 * 1000);
      expect(JSON.stringify(await db.passwordResetToken.findMany({ where: { userId: known.userId } }))).not.toContain(token);
    });

    it('sends at most one e-mail per minute per account, and a newer link invalidates the older one', async () => {
      const known = await account();
      mailer.messages = []; advance();
      await Promise.all([forgot(known.email), forgot(known.email), forgot(known.email)]);
      expect(mailer.messages).toHaveLength(1);
      const first = tokenFrom(mailer.messages[0]!);

      advance(30_000);
      await forgot(known.email);
      expect(mailer.messages).toHaveLength(1);

      advance(31_000);
      await forgot(known.email);
      expect(mailer.messages).toHaveLength(2);
      const second = tokenFrom(mailer.messages[1]!);
      expect((await validate(first)).statusCode).toBe(404);
      expect((await validate(second)).statusCode).toBe(200);
    });

    it('sends one message per account when the same e-mail exists in different teams, each naming its own team', async () => {
      const email = `${unique('shared')}@example.com`;
      const [a, b] = [await account({ email, name: 'Equipe Alfa' }), await account({ email, name: 'Equipe Beta' })];
      mailer.messages = []; advance();
      await forgot(email);
      expect(mailer.messages).toHaveLength(2);
      expect(mailer.messages.map((message) => message.text).join('\n')).toMatch(/Equipe Alfa[\s\S]*Equipe Beta|Equipe Beta[\s\S]*Equipe Alfa/);
      expect(await db.passwordResetToken.count({ where: { userId: { in: [a.userId, b.userId] } } })).toBe(2);
    });
  });

  describe('using the token', () => {
    it('validates, changes the password, consumes the token, creates no session and revokes the account sessions', async () => {
      const known = await account(); const bystander = await account();
      const cookie = await session(known.userId, known.organizationId); const otherCookie = await session(bystander.userId, bystander.organizationId);
      expect((await me(cookie)).statusCode).toBe(200);
      const token = await requestToken(known.email);
      expect((await validate(token)).statusCode).toBe(200);

      const response = await reset(token, 'NewPassw0rd');
      expect(response.statusCode).toBe(200);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toMatch(/token|passwordHash|NewPassw0rd/i);

      expect((await login(known.email, 'NewPassw0rd')).statusCode).toBe(200);
      expect((await login(known.email, password)).statusCode).toBe(401);
      expect((await me(cookie)).statusCode).toBe(401);
      expect(await db.session.count({ where: { userId: known.userId, revokedAt: null } })).toBe(1); // so a do login acima
      expect((await me(otherCookie)).statusCode).toBe(200);
      expect(await bcrypt.compare('NewPassw0rd', (await db.user.findUniqueOrThrow({ where: { id: known.userId } })).passwordHash!)).toBe(true);
      expect((await db.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashResetToken(token) } })).usedAt).not.toBeNull();
    });

    it('answers one generic 404 for unknown, malformed, tampered, expired and reused tokens, never changing a password', async () => {
      const known = await account();
      const token = await requestToken(known.email);
      const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
      const expired = await requestToken(known.email);
      await db.passwordResetToken.update({ where: { tokenHash: hashResetToken(expired) }, data: { expiresAt: new Date(now.getTime() - 1000) } });
      const used = await requestToken(known.email);
      expect((await reset(used, 'FirstNew1pass')).statusCode).toBe(200);

      const attempts = ['x'.repeat(43), 'curto', '', tampered, token, expired, used];
      const answers = await Promise.all(attempts.flatMap((candidate) => [reset(candidate, 'Hacked1Password'), validate(candidate)]));
      for (const response of answers) {
        expect(response.statusCode).toBe(404);
        expect(response.json().message).toBe('Reset link not found or no longer valid');
      }
      expect((await login(known.email, 'FirstNew1pass')).statusCode).toBe(200);
      expect((await login(known.email, 'Hacked1Password')).statusCode).toBe(401);
    });

    it('rejects a weak password without consuming the token, and rejects unexpected fields', async () => {
      const known = await account();
      const token = await requestToken(known.email);
      for (const weak of ['short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere', 'x'.repeat(129)]) expect((await reset(token, weak)).statusCode, weak).toBe(400);
      expect((await post('/api/auth/password/reset', { token, password: 'NewPassw0rd', userId: randomUUID() })).statusCode).toBe(400);
      expect((await post('/api/auth/password/reset', { token, password: 'NewPassw0rd', email: 'other@example.com' })).statusCode).toBe(400);
      expect((await validate(token)).statusCode).toBe(200);
      expect((await login(known.email, password)).statusCode).toBe(200);
      expect((await reset(token, 'NewPassw0rd')).statusCode).toBe(200);
    });

    it('lets exactly one of many simultaneous uses of the same token win', async () => {
      for (let round = 0; round < 3; round += 1) {
        const known = await account();
        const cookie = await session(known.userId, known.organizationId);
        const token = await requestToken(known.email);
        const attempts = Array.from({ length: 8 }, (_, index) => `Concurrent${index}Pass`);
        const responses = await Promise.all(attempts.map((candidate) => reset(token, candidate)));

        expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
        expect(responses.filter((response) => response.statusCode === 404)).toHaveLength(7);
        const winner = attempts[responses.findIndex((response) => response.statusCode === 200)]!;
        const stored = (await db.user.findUniqueOrThrow({ where: { id: known.userId } })).passwordHash!;
        expect(await bcrypt.compare(winner, stored)).toBe(true);
        for (const loser of attempts.filter((candidate) => candidate !== winner)) expect(await bcrypt.compare(loser, stored)).toBe(false);
        expect((await me(cookie)).statusCode).toBe(401);
      }
    });

    it('never gives a Google-only account a password, even if a token somehow exists for it', async () => {
      const google = await db.organization.create({ data: { name: 'Org Google 2', slug: unique('g') } });
      const user = await db.user.create({ data: { organizationId: google.id, name: 'G', email: `${unique('g')}@example.com`, role: UserRole.OWNER, passwordHash: null } });
      const token = 'G'.repeat(43);
      await db.passwordResetToken.create({ data: { userId: user.id, organizationId: google.id, tokenHash: hashResetToken(token), expiresAt: new Date(now.getTime() + 600_000) } });
      expect((await validate(token)).statusCode).toBe(404);
      expect((await reset(token, 'NewPassw0rd')).statusCode).toBe(404);
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBeNull();
      expect((await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } })).usedAt).toBeNull();
    });

    it('changes only the account the token belongs to when the same e-mail exists in another team', async () => {
      const email = `${unique('twin')}@example.com`;
      const [a, b] = [await account({ email, name: 'Gemea A' }), await account({ email, name: 'Gemea B' })];
      const cookieA = await session(a.userId, a.organizationId); const cookieB = await session(b.userId, b.organizationId);
      mailer.messages = []; advance(); await forgot(email);
      const forB = mailer.messages.find((message) => message.text.includes('Gemea B'))!;

      // Repetir a senha da outra conta e recusado (o login as distingue pela senha) e nao consome o token.
      expect((await reset(tokenFrom(forB), password)).statusCode).toBe(409);
      expect((await validate(tokenFrom(forB))).statusCode).toBe(200);

      expect((await reset(tokenFrom(forB), 'TwinNewPass9')).statusCode).toBe(200);
      expect((await me(cookieB)).statusCode).toBe(401);
      expect((await me(cookieA)).statusCode).toBe(200);
      expect(await bcrypt.compare(password, (await db.user.findUniqueOrThrow({ where: { id: a.userId } })).passwordHash!)).toBe(true);
      expect((await login(email, 'TwinNewPass9')).json().user.organizationId).toBe(b.organizationId);
      expect((await login(email, password)).json().user.organizationId).toBe(a.organizationId);
    });
  });

  describe('e-mail delivery', () => {
    it('keeps answering 202 and leaves no usable token when the provider fails, then recovers on the next request', async () => {
      const known = await account();
      mailer.messages = []; advance(); mailer.failNext = 1;
      const failed = await forgot(known.email);
      expect(failed.statusCode).toBe(202);
      expect(mailer.messages).toHaveLength(0);
      // Token nao entregue e apagado: nao fica nada utilizavel e a falha tambem nao conta para o intervalo de reenvio.
      expect(await db.passwordResetToken.count({ where: { userId: known.userId } })).toBe(0);

      await forgot(known.email);
      expect(mailer.messages).toHaveLength(1);
      expect((await validate(tokenFrom(mailer.messages[0]!))).statusCode).toBe(200);
    });

    it('creates no token and sends nothing when no mail provider is configured, still answering the same way', async () => {
      const known = await account();
      const disabledService = new PasswordRecoveryService({ repository: new PrismaPasswordResetRepository(db), mailer: new DisabledMailer(), appBaseUrl: base });
      const disabledApp = buildApp({ authRepository: auth, mailer: new DisabledMailer(), passwordRecovery: disabledService });
      await disabledApp.ready();
      const response = await disabledApp.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: known.email } });
      await disabledService.idle();
      expect(response.statusCode).toBe(202);
      expect(await db.passwordResetToken.count({ where: { userId: known.userId } })).toBe(0);
      await disabledApp.close();
    });

    it('exposes the development outbox only when the in-memory mailer is configured', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/dev/mail-outbox' })).statusCode).toBe(404);
      const outbox = new OutboxMailer();
      const outboxService = new PasswordRecoveryService({ repository: new PrismaPasswordResetRepository(db), mailer: outbox, appBaseUrl: base });
      const outboxApp = buildApp({ authRepository: auth, mailer: outbox, passwordRecovery: outboxService });
      await outboxApp.ready();
      const known = await account();
      await outboxApp.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: known.email } });
      await outboxService.idle();
      const listed = await outboxApp.inject({ method: 'GET', url: '/api/dev/mail-outbox' });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().messages[0].to).toBe(known.email);
      await outboxApp.close();
    });
  });

  describe('logs', () => {
    it('never writes tokens, links, passwords or e-mail addresses to the log, including on failures', async () => {
      logs.length = 0;
      const known = await account(); const unknown = `${unique('ghost')}@example.com`;
      mailer.messages = []; advance(); mailer.failNext = 1;
      await forgot(known.email);                       // falha de envio
      advance(); await forgot(known.email);            // sucesso
      await forgot(unknown);
      const token = tokenFrom(mailer.messages[0]!);
      await validate(token);
      await reset(token, 'LoggedNewPass1');
      await reset(token, 'LoggedNewPass1');            // reutilizacao
      await post('/api/auth/password/reset', { token: 'curto', password: 'LoggedNewPass1' });

      const output = logs.join('');
      expect(output.length).toBeGreaterThan(0);
      for (const secret of [token, hashResetToken(token), 'reset-password', 'LoggedNewPass1', known.email, unknown, 'StrongPass1']) expect(output, secret).not.toContain(secret);
      expect(output).toContain('Password recovery e-mail could not be delivered');
    });
  });

  describe('compatibility with the rest of authentication', () => {
    it('keeps password login, public signup, invitations and the Google linking refusal working', async () => {
      const email = `${unique('new')}@example.com`;
      expect((await post('/api/auth/register', { organizationName: 'Recovery Co', name: 'Dono', email, password })).statusCode).toBe(201);
      expect((await login(email, password)).statusCode).toBe(200);
      expect((await login(email, 'WrongPass1x')).statusCode).toBe(401);

      const token = await requestToken(email);
      expect((await reset(token, 'AfterReset1pass')).statusCode).toBe(200);
      expect((await login(email, 'AfterReset1pass')).statusCode).toBe(200);
      // Recuperar a senha nunca abre caminho para vincular uma identidade Google por e-mail.
      await expect(resolveGoogleUser(auth, { providerAccountId: unique('sub'), email, name: 'Impostor' })).rejects.toBeInstanceOf(GoogleAccountNotLinkedError);

      const owner = await login(email, 'AfterReset1pass');
      const cookie = String(owner.headers['set-cookie']).split(';')[0]!;
      const invitee = `${unique('invitee')}@example.com`;
      const invite = await app.inject({ method: 'POST', url: '/api/team/invitations', headers: { cookie }, payload: { email: invitee, role: 'TECHNICIAN' } });
      expect(invite.statusCode).toBe(201);
      expect((await post('/api/auth/invitations/accept', { token: invite.json().token, name: 'Novo', password })).statusCode).toBe(201);
    });
  });
});
