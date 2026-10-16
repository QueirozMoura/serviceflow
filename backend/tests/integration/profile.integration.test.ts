import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas). Nada aqui toca o banco de desenvolvimento.
const temporary: TemporaryDatabase = createTemporaryDatabase('profile');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;

const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { makeOrganizationSlug } = await import('../../src/modules/auth/service.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { env } = await import('../../src/config/env.js');

describe('PATCH /api/auth/me against a real PostgreSQL database', () => {
  let db: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBe(temporary.url);
    expect(new URL(temporary.url).pathname).toMatch(/^\/serviceflow_it_profile_/);
    db = new PrismaClient({ datasources: { db: { url: temporary.url } } });
    app = buildApp({ authRepository: new PrismaAuthRepository(db) });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    temporary.drop();
  }, 60_000);

  // Conta e sessao criadas direto no banco temporario: register/login tem rate limit proprio e nao e o objeto deste teste.
  async function account(name: string, email: string) {
    const repository = new PrismaAuthRepository(db);
    const { user } = await repository.createOrganizationWithOwner({ organizationName: `Org ${name}`, slug: makeOrganizationSlug(`Org ${name}`), name, email, passwordHash: await bcrypt.hash('StrongPass1', 4) });
    const { token, tokenHash } = createSessionToken();
    await repository.createSession({ tokenHash, userId: user.id, organizationId: user.organizationId, expiresAt: sessionExpiresAt() });
    return { id: user.id, organizationId: user.organizationId, email, cookie: `${env.AUTH_COOKIE_NAME}=${token}` };
  }
  const row = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
  const patch = (cookie: string, payload: unknown) => app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie }, payload: payload as object });

  it("updates only the caller's own row and never another user's or organization's", async () => {
    const alice = await account('Alice', 'alice@example.com');
    const bruno = await account('Bruno', 'bruno@example.com');
    // Colega na MESMA organizacao da Alice, criado direto no banco temporario (a API so cria o OWNER no registro).
    const colleague = await db.user.create({ data: { organizationId: alice.organizationId, name: 'Colega', email: 'colega@example.com', role: UserRole.TECHNICIAN } });
    const before = { bruno: await row(bruno.id), colleague: await row(colleague.id), alice: await row(alice.id) };

    const response = await patch(alice.cookie, { name: '  Alice Souza  ' });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ id: alice.id, name: 'Alice Souza', email: alice.email, role: 'OWNER', organizationId: alice.organizationId });
    const after = { bruno: await row(bruno.id), colleague: await row(colleague.id), alice: await row(alice.id) };
    expect(after.alice).toMatchObject({ name: 'Alice Souza', email: before.alice.email, role: before.alice.role, organizationId: before.alice.organizationId, passwordHash: before.alice.passwordHash });
    expect(after.bruno).toEqual(before.bruno);
    expect(after.colleague).toEqual(before.colleague);
    expect(await db.user.count()).toBe(3);
  });

  it("rejects protected fields and another user's identifiers, leaving every row untouched", async () => {
    const carla = await account('Carla', 'carla@example.com');
    const diego = await account('Diego', 'diego@example.com');
    const snapshot = async () => JSON.stringify(await db.user.findMany({ orderBy: { id: 'asc' } }));
    const before = await snapshot();

    for (const extra of [{ id: diego.id }, { userId: diego.id }, { organizationId: diego.organizationId }, { email: 'stolen@example.com' }, { role: 'ADMIN' }, { passwordHash: 'x' }]) {
      const response = await patch(carla.cookie, { name: 'Takeover', ...extra });
      expect(response.statusCode).toBe(400);
    }

    expect(await snapshot()).toBe(before);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: carla.email, password: 'StrongPass1' } })).statusCode).toBe(200);
  });

  it('scopes the repository SQL by organization as well as by user id', async () => {
    const erica = await account('Erica', 'erica@example.com');
    const fabio = await account('Fabio', 'fabio@example.com');
    const repository = new PrismaAuthRepository(db);

    expect(await repository.updateUserName(fabio.id, erica.organizationId, 'Cross Organization')).toBeNull();
    expect((await row(fabio.id)).name).toBe('Fabio');
    expect(await repository.updateUserName('00000000-0000-4000-8000-000000000000', erica.organizationId, 'Ghost')).toBeNull();

    const own = await repository.updateUserName(fabio.id, fabio.organizationId, 'Fabio Lima');
    expect(own?.name).toBe('Fabio Lima');
    expect((await row(erica.id)).name).toBe('Erica');
  });

  it('requires a valid session and does not write anything without one', async () => {
    const gisele = await account('Gisele', 'gisele@example.com');
    const anonymous = await app.inject({ method: 'PATCH', url: '/api/auth/me', payload: { name: 'Intruder' } });
    const forged = await patch(`${env.AUTH_COOKIE_NAME}=forged`, { name: 'Intruder' });
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: gisele.cookie } });
    const revoked = await patch(gisele.cookie, { name: 'Intruder' });

    expect([anonymous.statusCode, forged.statusCode, revoked.statusCode]).toEqual([401, 401, 401]);
    expect((await row(gisele.id)).name).toBe('Gisele');
  });
});
