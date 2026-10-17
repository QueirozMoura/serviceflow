import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas, incluindo a de Invitation). Corridas = app.inject em
// Promise.all contra o pool real do Prisma.
const temporary: TemporaryDatabase = createTemporaryDatabase('team');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { PrismaTeamRepository } = await import('../../src/modules/team/repository.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { hashInvitationToken } = await import('../../src/modules/team/tokens.js');
const { resolveGoogleUser, GoogleAccountNotLinkedError } = await import('../../src/modules/auth/service.js');
const { env } = await import('../../src/config/env.js');

describe('team management and email signup against a real PostgreSQL database', () => {
  let db: PrismaClient;
  let auth: InstanceType<typeof PrismaAuthRepository>;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: temporary.url } } });
    auth = new PrismaAuthRepository(db);
    app = buildApp({ authRepository: auth });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    temporary.drop();
  }, 60_000);

  type Actor = { id: string; cookie: string };
  const password = 'StrongPass1';
  let counter = 0;
  const unique = (label: string) => `${label}-${++counter}-${randomUUID().slice(0, 6)}`;

  async function cookieFor(userId: string, organizationId: string): Promise<Actor> {
    const { token, tokenHash } = createSessionToken();
    await auth.createSession({ tokenHash, userId, organizationId, expiresAt: sessionExpiresAt() });
    return { id: userId, cookie: `${env.AUTH_COOKIE_NAME}=${token}` };
  }
  const post = (url: string, payload: object, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload, headers });
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, actor?: Actor, payload?: object) =>
    app.inject({ method, url, headers: actor ? { cookie: actor.cookie } : {}, ...(payload ? { payload } : {}) });

  /** Cadastro pela API publica; devolve a organizacao, o dono (com sessao) e membros ADMIN/TECHNICIAN ja criados no banco. */
  async function signup(organizationName = unique('Assistencia')) {
    const email = `${unique('owner')}@example.com`;
    const response = await post('/api/auth/register', { organizationName, name: 'Dono', email, password });
    expect(response.statusCode).toBe(201);
    const { user } = response.json();
    const member = async (role: UserRole) => {
      const created = await db.user.create({ data: { organizationId: user.organizationId, name: role, email: `${unique(role.toLowerCase())}@example.com`, role, passwordHash: await bcrypt.hash(password, 4) } });
      return cookieFor(created.id, user.organizationId);
    };
    return { organizationId: user.organizationId as string, email, owner: await cookieFor(user.id, user.organizationId), admin: await member(UserRole.ADMIN), technician: await member(UserRole.TECHNICIAN) };
  }

  const invite = (actor: Actor | undefined, email: string, role: string = 'TECHNICIAN') => call('POST', '/api/team/invitations', actor, { email, role });
  const accept = (token: string, extra: object = {}) => post('/api/auth/invitations/accept', { token, name: 'Novo Membro', password, ...extra });
  const tokenOf = (response: Awaited<ReturnType<typeof invite>>) => response.json().token as string;

  describe('email signup', () => {
    it('creates the organization and its OWNER atomically, hashing the password and never exposing it', async () => {
      const email = `${unique('novo')}@example.com`;
      const response = await post('/api/auth/register', { organizationName: 'Tech Fix', name: 'Maria', email: email.toUpperCase(), password });
      expect(response.statusCode).toBe(201);
      expect(response.body).not.toMatch(/passwordHash|StrongPass1/);
      expect(response.json().user).toMatchObject({ role: 'OWNER', email });

      const user = await db.user.findFirstOrThrow({ where: { email }, include: { organization: true } });
      expect(user.role).toBe('OWNER');
      expect(user.organization.name).toBe('Tech Fix');
      expect(user.passwordHash).not.toBeNull();
      expect(user.passwordHash).not.toContain(password);
      expect(await bcrypt.compare(password, user.passwordHash!)).toBe(true);
      expect(await db.user.count({ where: { organizationId: user.organizationId } })).toBe(1);
    });

    it('does not let the client pick a role or an organization, and rejects invalid data without writing anything', async () => {
      const before = { organizations: await db.organization.count(), users: await db.user.count() };
      const email = `${unique('x')}@example.com`;
      const invalid: object[] = [
        { organizationName: 'Org', name: 'Ana', email, password, role: 'ADMIN' },
        { organizationName: 'Org', name: 'Ana', email, password, organizationId: randomUUID() },
        { organizationName: 'O', name: 'Ana', email, password },
        { organizationName: 'Org', name: 'A', email, password },
        { organizationName: 'Org', name: 'Ana', email: 'not-an-email', password },
        { organizationName: 'Org', name: 'Ana', email, password: 'short1A' },
        { organizationName: 'Org', name: 'Ana', email, password: 'alllowercase1' },
        { organizationName: 'Org', name: 'Ana', email },
      ];
      for (const payload of invalid) expect((await post('/api/auth/register', payload)).statusCode, JSON.stringify(payload)).toBe(400);
      expect({ organizations: await db.organization.count(), users: await db.user.count() }).toEqual(before);
    });

    it('registers two companies with the same name, keeping the original name and distinct slugs', async () => {
      const [a, b] = [await signup('Mesma Assistencia'), await signup('Mesma Assistencia')];
      const orgs = await db.organization.findMany({ where: { id: { in: [a.organizationId, b.organizationId] } } });
      expect(orgs.map((org) => org.name)).toEqual(['Mesma Assistencia', 'Mesma Assistencia']);
      expect(new Set(orgs.map((org) => org.slug)).size).toBe(2);
      for (const org of orgs) expect(org.slug).toMatch(/^mesma-assistencia-[0-9a-f]{8}$/);
    });

    it('survives many simultaneous signups with the same company name: every one succeeds with a unique slug', async () => {
      const name = unique('Concorrente');
      const responses = await Promise.all(Array.from({ length: 12 }, () => post('/api/auth/register', { organizationName: name, name: 'Dono', email: `${unique('c')}@example.com`, password })));
      expect(responses.map((response) => response.statusCode)).toEqual(Array(12).fill(201));
      const orgs = await db.organization.findMany({ where: { name } });
      expect(orgs).toHaveLength(12);
      expect(new Set(orgs.map((org) => org.slug)).size).toBe(12);
      expect(await db.user.count({ where: { organizationId: { in: orgs.map((org) => org.id) }, role: 'OWNER' } })).toBe(12);
    });

    it('retries a slug collision with a fresh suffix instead of failing, and leaves nothing half-created when it gives up', async () => {
      // Colisao forcada: o repositorio falha com P2002 nas duas primeiras tentativas e depois grava de verdade.
      let attempts = 0;
      const flaky = new PrismaAuthRepository(db);
      const real = flaky.createOrganizationWithOwner.bind(flaky);
      flaky.createOrganizationWithOwner = async (input) => {
        attempts += 1;
        if (attempts <= 2) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: ['slug'] } });
        return real(input);
      };
      const { registerAccount } = await import('../../src/modules/auth/service.js');
      const email = `${unique('retry')}@example.com`;
      const account = await registerAccount(flaky, { organizationName: 'Retry Co', name: 'Dono', email, password });
      expect(attempts).toBe(3);
      expect(account.organization.name).toBe('Retry Co');

      attempts = -100;
      const alwaysFailing = new PrismaAuthRepository(db);
      alwaysFailing.createOrganizationWithOwner = async () => { attempts += 1; throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }); };
      const orgs = await db.organization.count();
      await expect(registerAccount(alwaysFailing, { organizationName: 'Never', name: 'Dono', email: `${unique('never')}@example.com`, password })).rejects.toThrow();
      expect(attempts).toBe(-100 + 5);
      expect(await db.organization.count()).toBe(orgs);
    });

    it('leaves no organization behind when creating the owner fails inside the transaction', async () => {
      const before = await db.organization.count();
      const failing = new PrismaAuthRepository(new Proxy(db, {
        get: (target, property) => property !== '$transaction' ? Reflect.get(target, property) : (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction((client) => callback(new Proxy(client, {
          get: (inner, name) => name !== 'user' ? Reflect.get(inner, name) : new Proxy(inner.user, { get: (delegate, operation) => operation === 'create' ? () => { throw new Error('simulated failure'); } : (Reflect.get(delegate, operation) as (...args: unknown[]) => unknown).bind(delegate) }),
        }))),
      }) as PrismaClient);
      await expect(failing.createOrganizationWithOwner({ organizationName: 'Atomic', slug: unique('atomic'), name: 'Dono', email: `${unique('a')}@example.com`, passwordHash: 'x' })).rejects.toThrow('simulated failure');
      expect(await db.organization.count()).toBe(before);
    });

    it('refuses an email that already has an account with the generic message, creating nothing', async () => {
      const team = await signup();
      const before = await db.organization.count();
      const response = await post('/api/auth/register', { organizationName: 'Outra', name: 'Dono 2', email: team.email, password });
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toBe('Unable to create account');
      expect(await db.organization.count()).toBe(before);
    });

    it('lets the new owner log in with the usual HttpOnly cookie and receive the OWNER permissions, including team management', async () => {
      const team = await signup();
      const login = await post('/api/auth/login', { email: team.email, password });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']);
      expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=/i);
      expect(login.json().user.permissions).toEqual(expect.arrayContaining(['team:read', 'team:manage']));
    });
  });

  describe('invitations: who may manage the team', () => {
    it('lets only the OWNER list members, create, list and revoke invitations', async () => {
      const team = await signup();
      const target = `${unique('novo')}@example.com`;
      for (const actor of [team.admin, team.technician]) {
        expect((await invite(actor, target)).statusCode).toBe(403);
        expect((await call('GET', '/api/team/members', actor)).statusCode).toBe(403);
        expect((await call('GET', '/api/team/invitations', actor)).statusCode).toBe(403);
        expect((await call('DELETE', `/api/team/invitations/${randomUUID()}`, actor)).statusCode).toBe(403);
      }
      expect((await invite(undefined, target)).statusCode).toBe(401);
      expect(await db.invitation.count({ where: { organizationId: team.organizationId } })).toBe(0);

      const created = await invite(team.owner, target, 'ADMIN');
      expect(created.statusCode).toBe(201);
      expect(created.headers['cache-control']).toBe('no-store');
      const members = (await call('GET', '/api/team/members', team.owner)).json().members;
      expect(members.map((member: { role: string }) => member.role).sort()).toEqual(['ADMIN', 'OWNER', 'TECHNICIAN']);
      expect(JSON.stringify(members)).not.toMatch(/passwordHash|tokenHash/);
      const pending = (await call('GET', '/api/team/invitations', team.owner)).json().invitations;
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ email: target, role: 'ADMIN', status: 'PENDING' });
      expect(JSON.stringify(pending)).not.toMatch(/token/i);
    });

    it('never lets the client choose the role beyond ADMIN/TECHNICIAN, the organization, or other fields', async () => {
      const team = await signup(); const other = await signup();
      const email = `${unique('x')}@example.com`;
      const bodies: object[] = [
        { email, role: 'OWNER' }, { email, role: 'owner' }, { email, role: 'SUPERUSER' }, { email }, { role: 'TECHNICIAN' },
        { email, role: 'TECHNICIAN', organizationId: other.organizationId }, { email, role: 'TECHNICIAN', expiresAt: '2099-01-01' },
        { email, role: 'TECHNICIAN', createdByUserId: other.owner.id }, { email: 'invalido', role: 'TECHNICIAN' },
      ];
      for (const body of bodies) expect((await call('POST', '/api/team/invitations', team.owner, body)).statusCode, JSON.stringify(body)).toBe(400);
      expect(await db.invitation.count({ where: { organizationId: { in: [team.organizationId, other.organizationId] } } })).toBe(0);

      const ok = await invite(team.owner, email, 'TECHNICIAN');
      expect(ok.statusCode).toBe(201);
      const row = await db.invitation.findFirstOrThrow({ where: { email } });
      expect(row).toMatchObject({ organizationId: team.organizationId, role: 'TECHNICIAN', createdByUserId: team.owner.id });
    });

    it('enforces in the database that an invitation can never grant OWNER', async () => {
      const team = await signup();
      await expect(db.invitation.create({ data: { organizationId: team.organizationId, email: 'x@example.com', role: 'OWNER', tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 1000), createdByUserId: team.owner.id } })).rejects.toThrow();
    });

    it('refuses to invite someone who is already a member, and replaces an older pending invitation for the same email', async () => {
      const team = await signup();
      expect((await invite(team.owner, team.email)).statusCode).toBe(409);
      const target = `${unique('dup')}@example.com`;
      const first = await invite(team.owner, target); const second = await invite(team.owner, target, 'ADMIN');
      expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
      expect((await accept(tokenOf(first))).statusCode).toBe(404);
      expect((await call('GET', '/api/team/invitations', team.owner)).json().invitations).toHaveLength(1);
      expect((await accept(tokenOf(second))).statusCode).toBe(201);
    });

    it('keeps only one valid invitation when several are created at once for the same email', async () => {
      const team = await signup(); const target = `${unique('race')}@example.com`;
      const responses = await Promise.all(Array.from({ length: 6 }, () => invite(team.owner, target)));
      expect(responses.map((response) => response.statusCode)).toEqual(Array(6).fill(201));
      expect(await db.invitation.count({ where: { organizationId: team.organizationId, email: target, revokedAt: null, acceptedAt: null } })).toBe(1);
    });
  });

  describe('invitations: acceptance', () => {
    it('stores only a hash of the token and never returns it again', async () => {
      const team = await signup(); const target = `${unique('hash')}@example.com`;
      const created = await invite(team.owner, target);
      const token = tokenOf(created);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const row = await db.invitation.findFirstOrThrow({ where: { email: target } });
      expect(row.tokenHash).toBe(hashInvitationToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
      expect(JSON.stringify((await call('GET', '/api/team/invitations', team.owner)).json())).not.toContain(token);
    });

    it('creates a new member with the role, organization and email of the invitation, a session and nothing else', async () => {
      const team = await signup(); const target = `${unique('novo')}@example.com`;
      const token = tokenOf(await invite(team.owner, target, 'TECHNICIAN'));
      const before = await db.user.count({ where: { organizationId: team.organizationId } });

      const preview = await post('/api/auth/invitations/inspect', { token });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().invitation).toMatchObject({ email: target, role: 'TECHNICIAN' });
      expect(await db.user.count({ where: { organizationId: team.organizationId } })).toBe(before);

      const accepted = await accept(token);
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json().user).toMatchObject({ email: target, role: 'TECHNICIAN', organizationId: team.organizationId });
      expect(accepted.json().user.permissions).not.toContain('team:manage');
      expect(accepted.body).not.toMatch(/passwordHash|tokenHash/);
      const cookie = String(accepted.headers['set-cookie']);
      expect(cookie).toMatch(/HttpOnly/i);

      const user = await db.user.findFirstOrThrow({ where: { email: target } });
      expect(user).toMatchObject({ organizationId: team.organizationId, role: 'TECHNICIAN', name: 'Novo Membro' });
      expect(await bcrypt.compare(password, user.passwordHash!)).toBe(true);
      expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
      expect((await db.invitation.findFirstOrThrow({ where: { email: target } })).acceptedAt).not.toBeNull();

      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookie.split(';')[0]! } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.organization.id).toBe(team.organizationId);
      // E ele ja pode fazer login normalmente.
      expect((await post('/api/auth/login', { email: target, password })).statusCode).toBe(200);
    });

    it('ignores any attempt by the invitee to pick the role, organization or email', async () => {
      const team = await signup(); const other = await signup(); const target = `${unique('esperto')}@example.com`;
      const token = tokenOf(await invite(team.owner, target, 'TECHNICIAN'));
      for (const extra of [{ role: 'OWNER' }, { organizationId: other.organizationId }, { email: 'outro@example.com' }]) {
        expect((await accept(token, extra)).statusCode, JSON.stringify(extra)).toBe(400);
      }
      expect(await db.user.count({ where: { email: target } })).toBe(0);
      expect((await accept(token)).statusCode).toBe(201);
      expect(await db.user.count({ where: { organizationId: other.organizationId } })).toBe(3);
    });

    it('rejects reuse, expiry, revocation, tampered and unknown tokens with one indistinguishable answer, writing nothing', async () => {
      const team = await signup();
      const used = tokenOf(await invite(team.owner, `${unique('u')}@example.com`)); expect((await accept(used)).statusCode).toBe(201);
      const revoked = await invite(team.owner, `${unique('r')}@example.com`);
      expect((await call('DELETE', `/api/team/invitations/${revoked.json().invitation.id}`, team.owner)).statusCode).toBe(204);
      const expired = await invite(team.owner, `${unique('e')}@example.com`);
      await db.invitation.update({ where: { id: expired.json().invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const valid = tokenOf(await invite(team.owner, `${unique('v')}@example.com`));
      const tampered = `${valid.slice(0, -1)}${valid.endsWith('A') ? 'B' : 'A'}`;
      const attempts = [used, tokenOf(revoked), tokenOf(expired), tampered, 'x'.repeat(43), 'curto', ''];
      const usersBefore = await db.user.count();
      const answers = await Promise.all(attempts.flatMap((token) => [accept(token), post('/api/auth/invitations/inspect', { token })]));
      for (const response of answers) {
        expect(response.statusCode).toBe(404);
        expect(response.json().message).toBe('Invitation not found or no longer valid');
      }
      expect(await db.user.count()).toBe(usersBefore);
      // O convite valido continua intacto depois de todas as tentativas com tokens errados.
      expect((await accept(valid)).statusCode).toBe(201);
    });

    it('lets only one of several simultaneous acceptances win, creating a single member and a single session', async () => {
      const team = await signup(); const target = `${unique('corrida')}@example.com`;
      const token = tokenOf(await invite(team.owner, target));
      const responses = await Promise.all(Array.from({ length: 6 }, () => accept(token)));
      expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
      expect(responses.filter((response) => response.statusCode === 404)).toHaveLength(5);
      expect(await db.user.count({ where: { email: target } })).toBe(1);
      expect(await db.session.count({ where: { user: { email: target } } })).toBe(1);
    });

    it('rolls everything back when the session cannot be created, leaving the invitation usable', async () => {
      const team = await signup(); const target = `${unique('rollback')}@example.com`;
      const token = tokenOf(await invite(team.owner, target));
      const failing = new PrismaTeamRepository(new Proxy(db, {
        get: (property, name) => name !== '$transaction' ? Reflect.get(property, name) : (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => property.$transaction((client) => callback(new Proxy(client, {
          get: (inner, key) => key !== 'session' ? Reflect.get(inner, key) : new Proxy(inner.session, { get: (delegate, operation) => operation === 'create' ? () => { throw new Error('simulated failure'); } : (Reflect.get(delegate, operation) as (...args: unknown[]) => unknown).bind(delegate) }),
        }))),
      }) as PrismaClient);
      await expect(failing.acceptInvitation({ tokenHash: hashInvitationToken(token), name: 'Falha', passwordHash: 'x', sessionTokenHash: randomUUID(), sessionExpiresAt: sessionExpiresAt() })).rejects.toThrow('simulated failure');
      expect(await db.user.count({ where: { email: target } })).toBe(0);
      expect((await db.invitation.findFirstOrThrow({ where: { email: target } })).acceptedAt).toBeNull();
      expect((await accept(token)).statusCode).toBe(201);
    });

    it('lets a person who already has an account elsewhere join this team with a different password, without exposing anything', async () => {
      const home = await signup(); const team = await signup();
      const token = tokenOf(await invite(team.owner, home.email, 'ADMIN'));

      // A resposta de convite e a mesma para e-mail novo ou existente; so reaproveitar a senha da outra conta e recusado.
      const reused = await accept(token, { password });
      expect(reused.statusCode).toBe(409);
      expect(reused.json().message).toBe('Choose a different password');
      expect(await db.user.count({ where: { email: home.email } })).toBe(1);

      const joined = await accept(token, { password: 'OtherPass9' });
      expect(joined.statusCode).toBe(201);
      expect(joined.json().user).toMatchObject({ role: 'ADMIN', organizationId: team.organizationId });
      // As duas contas coexistem e cada senha entra na conta certa; a original nao mudou.
      const first = await post('/api/auth/login', { email: home.email, password });
      const second = await post('/api/auth/login', { email: home.email, password: 'OtherPass9' });
      expect(first.json().user.organizationId).toBe(home.organizationId);
      expect(second.json().user.organizationId).toBe(team.organizationId);
    });

    it('does not give access to the organization before the invitation is accepted', async () => {
      const team = await signup(); const target = `${unique('pre')}@example.com`;
      await invite(team.owner, target);
      expect(await db.user.count({ where: { email: target } })).toBe(0);
      expect((await post('/api/auth/login', { email: target, password })).statusCode).toBe(401);
    });

    it('does not let an accepted member keep or regain a revoked invitation, and refuses to revoke an accepted one', async () => {
      const team = await signup();
      const created = await invite(team.owner, `${unique('acc')}@example.com`);
      expect((await accept(tokenOf(created))).statusCode).toBe(201);
      const revoke = await call('DELETE', `/api/team/invitations/${created.json().invitation.id}`, team.owner);
      expect(revoke.statusCode).toBe(409);
      expect((await call('GET', '/api/team/invitations', team.owner)).json().invitations).toEqual([]);
    });
  });

  describe('multi-tenant isolation', () => {
    it('shows each owner only their own members and invitations, and answers 404 when revoking another team\'s invitation', async () => {
      const alpha = await signup(); const beta = await signup();
      const mine = await invite(alpha.owner, `${unique('a')}@example.com`);
      const theirs = await invite(beta.owner, `${unique('b')}@example.com`);

      const alphaMembers = (await call('GET', '/api/team/members', alpha.owner)).json().members;
      expect(alphaMembers).toHaveLength(3);
      expect(JSON.stringify(alphaMembers)).not.toContain(beta.email);
      const alphaInvitations = (await call('GET', '/api/team/invitations', alpha.owner)).json().invitations;
      expect(alphaInvitations.map((item: { id: string }) => item.id)).toEqual([mine.json().invitation.id]);

      const foreign = await call('DELETE', `/api/team/invitations/${theirs.json().invitation.id}`, alpha.owner);
      expect(foreign.statusCode).toBe(404);
      expect((await call('DELETE', `/api/team/invitations/${randomUUID()}`, alpha.owner)).statusCode).toBe(404);
      expect((await call('DELETE', '/api/team/invitations/nao-e-uuid', alpha.owner)).statusCode).toBe(404);
      expect((await db.invitation.findUniqueOrThrow({ where: { id: theirs.json().invitation.id } })).revokedAt).toBeNull();
      expect((await accept(tokenOf(theirs))).statusCode).toBe(201);
    });
  });

  describe('Google OAuth compatibility', () => {
    it('still refuses to link a Google identity to an account created by email signup or by invitation', async () => {
      const team = await signup(); const target = `${unique('g')}@example.com`;
      expect((await accept(tokenOf(await invite(team.owner, target)))).statusCode).toBe(201);
      const before = { orgs: await db.organization.count(), users: await db.user.count(), oauth: await db.oAuthAccount.count() };
      for (const email of [team.email, target]) {
        await expect(resolveGoogleUser(auth, { providerAccountId: unique('google'), email, name: 'Google User' })).rejects.toBeInstanceOf(GoogleAccountNotLinkedError);
      }
      expect({ orgs: await db.organization.count(), users: await db.user.count(), oauth: await db.oAuthAccount.count() }).toEqual(before);
    });

    it('still creates an organization for a brand new Google identity', async () => {
      const user = await resolveGoogleUser(auth, { providerAccountId: unique('google'), email: `${unique('novo')}@example.com`, name: 'Novo Google' });
      expect(user.role).toBe('OWNER');
      expect(user.passwordHash).toBeNull();
    });
  });
});
