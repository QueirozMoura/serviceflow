import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createTemporaryDatabase, type TemporaryDatabase } from './database.js';

// Banco temporario real (PostgreSQL local, migracoes aplicadas). Nada aqui toca o banco de desenvolvimento.
const temporary: TemporaryDatabase = createTemporaryDatabase('authz');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = temporary.url;
process.env.RATE_LIMIT_MAX = '100000';

const { buildApp } = await import('../../src/app.js');
const { PrismaAuthRepository } = await import('../../src/modules/auth/repository.js');
const { makeOrganizationSlug } = await import('../../src/modules/auth/service.js');
const { createSessionToken, sessionExpiresAt } = await import('../../src/modules/auth/session.js');
const { env } = await import('../../src/config/env.js');

describe('role-based authorization against a real PostgreSQL database', () => {
  let db: PrismaClient;
  let repository: InstanceType<typeof PrismaAuthRepository>;
  let app: FastifyInstance;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBe(temporary.url);
    expect(new URL(temporary.url).pathname).toMatch(/^\/serviceflow_it_authz_/);
    db = new PrismaClient({ datasources: { db: { url: temporary.url } } });
    repository = new PrismaAuthRepository(db);
    app = buildApp({ authRepository: repository });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    temporary.drop();
  }, 60_000);

  async function session(userId: string, organizationId: string) {
    const { token, tokenHash } = createSessionToken();
    await repository.createSession({ tokenHash, userId, organizationId, expiresAt: sessionExpiresAt() });
    return `${env.AUTH_COOKIE_NAME}=${token}`;
  }
  async function organization(name: string) {
    const { user } = await repository.createOrganizationWithOwner({ organizationName: `Org ${name}`, slug: makeOrganizationSlug(`Org ${name}`), name: `${name} Owner`, email: `${name.toLowerCase()}-owner@example.com`, passwordHash: await bcrypt.hash('StrongPass1', 4) });
    return { organizationId: user.organizationId, owner: { id: user.id, cookie: await session(user.id, user.organizationId) } };
  }
  async function member(organizationId: string, role: UserRole, name: string) {
    const user = await db.user.create({ data: { organizationId, name, email: `${name.toLowerCase()}@example.com`, role } });
    return { id: user.id, cookie: await session(user.id, organizationId) };
  }
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object, headers: Record<string, string> = {}) => app.inject({ method, url, headers: { cookie, ...headers }, ...(payload ? { payload } : {}) });
  async function customerFor(cookie: string, name = 'Cliente') {
    const response = await request('POST', '/api/customers', cookie, { name, phone: '11999999999' });
    expect(response.statusCode).toBe(201);
    return response.json().customer.id as string;
  }

  it('reads the role from the database on every request, so a role change applies to the same session', async () => {
    const { organizationId, owner } = await organization('Alpha');
    const technician = await member(organizationId, UserRole.TECHNICIAN, 'Tecnico');
    const customerId = await customerFor(owner.cookie);

    expect((await request('DELETE', `/api/customers/${customerId}`, technician.cookie)).statusCode).toBe(403);
    await db.user.update({ where: { id: technician.id }, data: { role: UserRole.ADMIN } });
    expect((await request('DELETE', `/api/customers/${customerId}`, technician.cookie)).statusCode).toBe(204);

    const second = await customerFor(owner.cookie, 'Outro');
    await db.user.update({ where: { id: technician.id }, data: { role: UserRole.TECHNICIAN } });
    expect((await request('DELETE', `/api/customers/${second}`, technician.cookie)).statusCode).toBe(403);
    expect(await db.customer.count({ where: { id: second } })).toBe(1);
  });

  it('answers 403 identically for foreign and nonexistent records and keeps the 404 policy for allowed roles', async () => {
    const alpha = await organization('Bravo');
    const beta = await organization('Charlie');
    const technician = await member(alpha.organizationId, UserRole.TECHNICIAN, 'Tecnico2');
    const admin = await member(alpha.organizationId, UserRole.ADMIN, 'Admin2');
    const foreignCustomer = await customerFor(beta.owner.cookie, 'De outra organizacao');
    const missing = '00000000-0000-4000-8000-000000000000';

    const foreign = await request('DELETE', `/api/customers/${foreignCustomer}`, technician.cookie);
    const absent = await request('DELETE', `/api/customers/${missing}`, technician.cookie);
    expect([foreign.statusCode, absent.statusCode]).toEqual([403, 403]);
    expect(foreign.json()).toEqual(absent.json());

    const adminForeign = await request('DELETE', `/api/customers/${foreignCustomer}`, admin.cookie);
    const adminAbsent = await request('DELETE', `/api/customers/${missing}`, admin.cookie);
    expect([adminForeign.statusCode, adminAbsent.statusCode]).toEqual([404, 404]);
    expect(adminForeign.json()).toEqual(adminAbsent.json());
    expect((await request('GET', `/api/customers/${foreignCustomer}`, alpha.owner.cookie)).statusCode).toBe(404);
    expect(await db.customer.count({ where: { id: foreignCustomer } })).toBe(1);
  });

  it('lets a TECHNICIAN run the bench workflow but not delete or touch payments, while OWNER/ADMIN can', async () => {
    const { organizationId, owner } = await organization('Delta');
    const technician = await member(organizationId, UserRole.TECHNICIAN, 'Tecnico3');
    const admin = await member(organizationId, UserRole.ADMIN, 'Admin3');

    const customerId = await customerFor(technician.cookie);
    const equipment = await request('POST', '/api/equipment', technician.cookie, { customerId, type: 'Notebook', brand: 'Dell' });
    expect(equipment.statusCode).toBe(201);
    const order = await request('POST', '/api/service-orders', technician.cookie, { customerId, equipmentId: equipment.json().equipment.id, problemDescription: 'Nao liga' });
    expect(order.statusCode).toBe(201);
    const orderId = order.json().serviceOrder.id as string;
    expect((await request('PATCH', `/api/service-orders/${orderId}`, technician.cookie, { technicianNotes: 'Verificar fonte' })).statusCode).toBe(200);
    expect((await request('PATCH', `/api/service-orders/${orderId}/status`, technician.cookie, { status: 'WAITING_DIAGNOSIS' })).statusCode).toBe(200);
    expect((await request('POST', `/api/service-orders/${orderId}/diagnosis`, technician.cookie, { description: 'Fonte queimada', estimatedCost: '150.00' })).statusCode).toBe(201);
    expect((await request('PATCH', `/api/service-orders/${orderId}/diagnosis`, technician.cookie, { description: 'Fonte e cabo' })).statusCode).toBe(200);
    expect((await request('POST', `/api/service-orders/${orderId}/quote`, technician.cookie, {})).statusCode).toBe(201);
    expect((await request('POST', `/api/service-orders/${orderId}/messages`, technician.cookie, { type: 'SERVICE_RECEIVED' })).statusCode).toBe(200);

    for (const [method, url, payload] of [
      ['DELETE', `/api/service-orders/${orderId}/diagnosis`, undefined],
      ['DELETE', `/api/service-orders/${orderId}/quote`, undefined],
      ['DELETE', `/api/service-orders/${orderId}`, undefined],
      ['DELETE', `/api/customers/${customerId}`, undefined],
      ['GET', `/api/service-orders/${orderId}/payments`, undefined],
      ['POST', `/api/service-orders/${orderId}/payments`, { amount: '100.00', method: 'PIX' }],
    ] as const) {
      expect((await request(method, url, technician.cookie, payload)).statusCode, `${method} ${url}`).toBe(403);
    }
    expect(await db.diagnosis.count({ where: { serviceOrderId: orderId } })).toBe(1);
    expect(await db.quote.count({ where: { serviceOrderId: orderId } })).toBe(1);
    expect(await db.payment.count({ where: { organizationId } })).toBe(0);

    // O pagamento exige valor devido definido (aqui, o valor final da OS) e uma Idempotency-Key.
    expect((await request('PATCH', `/api/service-orders/${orderId}`, admin.cookie, { finalValue: '100.00' })).statusCode).toBe(200);
    const payment = await request('POST', `/api/service-orders/${orderId}/payments`, admin.cookie, { amount: '100.00', method: 'PIX' }, { 'idempotency-key': 'authorization-payment-0001' });
    expect(payment.statusCode).toBe(201);
    expect((await request('PATCH', `/api/service-orders/${orderId}/payments/${payment.json().payment.id}/status`, owner.cookie, { status: 'PAID' })).statusCode).toBe(200);
    expect((await request('GET', `/api/service-orders/${orderId}/payments`, owner.cookie)).json().payments).toHaveLength(1);

    const ownerDashboard = (await request('GET', '/api/dashboard', owner.cookie)).json();
    const technicianDashboard = (await request('GET', '/api/dashboard', technician.cookie)).json();
    expect(ownerDashboard.payments.paidTotal).toBe('100.00');
    expect(technicianDashboard.payments).toBeNull();
    expect(technicianDashboard.serviceOrders.total).toBe(1);

    expect((await request('DELETE', `/api/service-orders/${orderId}/diagnosis`, admin.cookie)).statusCode).toBe(204);
    expect((await request('DELETE', `/api/service-orders/${orderId}/quote`, owner.cookie)).statusCode).toBe(204);
  });

  it('applies the OS lifecycle rules: technician advances and delivers, but never approves or cancels (in any state)', async () => {
    const { organizationId, owner } = await organization('Echo');
    const technician = await member(organizationId, UserRole.TECHNICIAN, 'Tecnico4');
    const admin = await member(organizationId, UserRole.ADMIN, 'Admin4');
    const missingOrder = '00000000-0000-4000-8000-000000000000';
    const customerId = await customerFor(technician.cookie);
    const equipmentId = (await request('POST', '/api/equipment', technician.cookie, { customerId, type: 'Notebook' })).json().equipment.id as string;
    const newOrder = async () => (await request('POST', '/api/service-orders', technician.cookie, { customerId, equipmentId, problemDescription: 'Defeito' })).json().serviceOrder.id as string;
    const status = (orderId: string, cookie: string, next: string) => request('PATCH', `/api/service-orders/${orderId}/status`, cookie, { status: next });
    const current = async (orderId: string) => (await db.serviceOrder.findUniqueOrThrow({ where: { id: orderId } })).status;

    // Cancelamento: tecnico 403 em qualquer estado nao terminal; ADMIN e OWNER cancelam.
    const cancelByAdmin = await newOrder();
    const cancelByOwner = await newOrder();
    expect((await status(cancelByAdmin, technician.cookie, 'CANCELLED')).statusCode).toBe(403);
    expect(await current(cancelByAdmin)).toBe('RECEIVED');
    expect((await status(cancelByAdmin, technician.cookie, 'WAITING_DIAGNOSIS')).statusCode).toBe(200);
    expect((await status(cancelByAdmin, technician.cookie, 'CANCELLED')).statusCode).toBe(403);
    expect(await current(cancelByAdmin)).toBe('WAITING_DIAGNOSIS');
    expect((await status(cancelByAdmin, admin.cookie, 'CANCELLED')).statusCode).toBe(200);
    expect(await current(cancelByAdmin)).toBe('CANCELLED');
    expect((await status(cancelByOwner, owner.cookie, 'CANCELLED')).statusCode).toBe(200);
    // A permissao vem antes da transicao: ate numa OS ja cancelada o tecnico recebe 403, nao 409.
    expect((await status(cancelByAdmin, technician.cookie, 'CANCELLED')).statusCode).toBe(403);

    // Ciclo completo: o tecnico avanca, mas aprovar e exclusivo de OWNER/ADMIN e cancelar e negado em TODO estado
    // (inclusive READY). Entrega so pela transicao existente READY -> DELIVERED; nenhuma transicao nova.
    const delivered = await newOrder();
    const cancelIsDenied = async (expected: string) => {
      expect((await status(delivered, technician.cookie, 'CANCELLED')).statusCode, `cancel at ${expected}`).toBe(403);
      expect(await current(delivered)).toBe(expected);
    };
    await cancelIsDenied('RECEIVED');
    expect((await status(delivered, technician.cookie, 'DELIVERED')).statusCode).toBe(409);
    expect((await status(delivered, technician.cookie, 'WAITING_DIAGNOSIS')).statusCode).toBe(200);
    await cancelIsDenied('WAITING_DIAGNOSIS');
    expect((await status(delivered, technician.cookie, 'WAITING_APPROVAL')).statusCode).toBe(200);
    await cancelIsDenied('WAITING_APPROVAL');
    // Aprovar a OS: 403 para o tecnico (a permissao vem antes da transicao e da consulta), liberado para ADMIN.
    expect((await status(delivered, technician.cookie, 'APPROVED')).statusCode).toBe(403);
    expect(await current(delivered)).toBe('WAITING_APPROVAL');
    expect((await status(delivered, admin.cookie, 'APPROVED')).statusCode).toBe(200);
    await cancelIsDenied('APPROVED');
    expect((await status(delivered, technician.cookie, 'IN_PROGRESS')).statusCode).toBe(200);
    await cancelIsDenied('IN_PROGRESS');
    expect((await status(delivered, technician.cookie, 'DELIVERED')).statusCode).toBe(409);
    expect(await current(delivered)).toBe('IN_PROGRESS');
    expect((await status(delivered, technician.cookie, 'READY')).statusCode).toBe(200);
    await cancelIsDenied('READY');
    expect((await status(delivered, technician.cookie, 'DELIVERED')).statusCode).toBe(200);
    expect(await current(delivered)).toBe('DELIVERED');
    expect((await db.serviceOrder.findUniqueOrThrow({ where: { id: delivered } })).completedAt).not.toBeNull();
    expect((await status(delivered, technician.cookie, 'CANCELLED')).statusCode).toBe(403);
    expect((await status(delivered, owner.cookie, 'CANCELLED')).statusCode).toBe(409);

    // OWNER tambem aprova a OS.
    const ownerApproves = await newOrder();
    for (const next of ['WAITING_DIAGNOSIS', 'WAITING_APPROVAL']) expect((await status(ownerApproves, technician.cookie, next)).statusCode).toBe(200);
    expect((await status(ownerApproves, owner.cookie, 'APPROVED')).statusCode).toBe(200);
    expect(await current(ownerApproves)).toBe('APPROVED');
    // ... e o READY pode ser cancelado por OWNER/ADMIN (permissoes atuais mantidas).
    for (const next of ['IN_PROGRESS', 'READY']) expect((await status(ownerApproves, technician.cookie, next)).statusCode).toBe(200);
    expect((await status(ownerApproves, technician.cookie, 'CANCELLED')).statusCode).toBe(403);
    expect((await status(ownerApproves, admin.cookie, 'CANCELLED')).statusCode).toBe(200);
    expect(await current(ownerApproves)).toBe('CANCELLED');

    // Garantias: o tecnico cria e edita, com as validacoes de status e de datas mantidas.
    const pending = await newOrder();
    const warranty = { startDate: '2026-10-15', endDate: '2027-10-15', description: 'Garantia de 12 meses' };
    expect((await request('POST', `/api/service-orders/${pending}/warranty`, technician.cookie, warranty)).statusCode).toBe(409);
    expect((await request('POST', `/api/service-orders/${delivered}/warranty`, technician.cookie, { ...warranty, endDate: '2026-01-01' })).statusCode).toBe(400);
    expect((await request('POST', `/api/service-orders/${delivered}/warranty`, technician.cookie, warranty)).statusCode).toBe(201);
    expect((await request('POST', `/api/service-orders/${delivered}/warranty`, technician.cookie, warranty)).statusCode).toBe(409);
    expect((await request('PATCH', `/api/service-orders/${delivered}/warranty`, technician.cookie, { description: 'Garantia estendida' })).statusCode).toBe(200);
    expect((await request('PATCH', `/api/service-orders/${delivered}/warranty`, technician.cookie, { endDate: '2020-01-01' })).statusCode).toBe(400);
    expect((await request('GET', `/api/service-orders/${delivered}/warranty`, technician.cookie)).json().warranty.description).toBe('Garantia estendida');
    expect((await request('DELETE', `/api/service-orders/${delivered}/warranty`, technician.cookie)).statusCode).toBe(403);

    // Status da garantia (expirar, cancelar, qualquer valor): exclusivo de OWNER/ADMIN; o tecnico recebe 403 sem alterar nada.
    const warrantyStatus = (cookie: string, next: string) => request('PATCH', `/api/service-orders/${delivered}/warranty/status`, cookie, { status: next });
    const storedWarranty = async () => (await db.warranty.findUniqueOrThrow({ where: { serviceOrderId: delivered } })).status;
    for (const next of ['EXPIRED', 'CANCELLED', 'ACTIVE']) expect((await warrantyStatus(technician.cookie, next)).statusCode, next).toBe(403);
    expect((await request('PATCH', `/api/service-orders/${delivered}/warranty/status`, technician.cookie, {})).statusCode).toBe(403);
    expect(await storedWarranty()).toBe('ACTIVE');
    expect((await request('PATCH', `/api/service-orders/${missingOrder}/warranty/status`, technician.cookie, { status: 'EXPIRED' })).statusCode).toBe(403);
    expect((await warrantyStatus(admin.cookie, 'EXPIRED')).statusCode).toBe(200);
    expect(await storedWarranty()).toBe('EXPIRED');
    expect((await warrantyStatus(technician.cookie, 'CANCELLED')).statusCode).toBe(403);
    expect((await warrantyStatus(owner.cookie, 'CANCELLED')).statusCode).toBe(409);
  });

  it('lets only OWNER and ADMIN change a quote status, while the technician can read and edit quotes and items', async () => {
    const { organizationId, owner } = await organization('Foxtrot');
    const technician = await member(organizationId, UserRole.TECHNICIAN, 'Tecnico5');
    const admin = await member(organizationId, UserRole.ADMIN, 'Admin5');
    const customerId = await customerFor(technician.cookie);
    const equipmentId = (await request('POST', '/api/equipment', technician.cookie, { customerId, type: 'Notebook' })).json().equipment.id as string;
    const quoteStatus = (orderId: string, cookie: string, next: string) => request('PATCH', `/api/service-orders/${orderId}/quote/status`, cookie, { status: next });
    const stored = async (orderId: string) => (await db.quote.findUniqueOrThrow({ where: { serviceOrderId: orderId } })).status;
    async function orderWithQuote() {
      const orderId = (await request('POST', '/api/service-orders', technician.cookie, { customerId, equipmentId, problemDescription: 'Orcar' })).json().serviceOrder.id as string;
      expect((await request('POST', `/api/service-orders/${orderId}/quote`, technician.cookie, { notes: 'Rascunho' })).statusCode).toBe(201);
      expect((await request('POST', `/api/service-orders/${orderId}/quote/items`, technician.cookie, { description: 'Fonte', quantity: '1', unitPrice: '50.00', type: 'PART' })).statusCode).toBe(201);
      return orderId;
    }

    const first = await orderWithQuote();
    expect((await request('GET', `/api/service-orders/${first}/quote`, technician.cookie)).json().quote.total).toBe('50');
    expect((await request('PATCH', `/api/service-orders/${first}/quote`, technician.cookie, { notes: 'Revisado' })).statusCode).toBe(200);
    expect((await quoteStatus(first, technician.cookie, 'APPROVED')).statusCode).toBe(403);
    expect((await quoteStatus(first, technician.cookie, 'REJECTED')).statusCode).toBe(403);
    expect(await stored(first)).toBe('PENDING');
    expect((await quoteStatus(first, admin.cookie, 'APPROVED')).statusCode).toBe(200);
    expect(await stored(first)).toBe('APPROVED');
    // Permissao antes da transicao: ja decidido, o tecnico continua recebendo 403 (nao 409).
    expect((await quoteStatus(first, technician.cookie, 'REJECTED')).statusCode).toBe(403);
    expect((await quoteStatus(first, owner.cookie, 'REJECTED')).statusCode).toBe(409);

    const second = await orderWithQuote();
    expect((await quoteStatus(second, owner.cookie, 'REJECTED')).statusCode).toBe(200);
    expect(await stored(second)).toBe('REJECTED');

    // Expirar tambem e decisao comercial: o tecnico nao altera nenhum status do orcamento.
    const third = await orderWithQuote();
    for (const next of ['EXPIRED', 'PENDING']) expect((await quoteStatus(third, technician.cookie, next)).statusCode, next).toBe(403);
    expect(await stored(third)).toBe('PENDING');
    expect((await quoteStatus(third, admin.cookie, 'EXPIRED')).statusCode).toBe(200);
    expect(await stored(third)).toBe('EXPIRED');

    // Nenhum outro caminho altera o status do orcamento nem da OS.
    const fourth = await orderWithQuote();
    expect((await request('PATCH', `/api/service-orders/${fourth}/quote`, technician.cookie, { status: 'APPROVED' })).statusCode).toBe(400);
    expect((await request('PATCH', `/api/service-orders/${fourth}`, technician.cookie, { status: 'CANCELLED' })).statusCode).toBe(400);
    expect(await stored(fourth)).toBe('PENDING');
    expect((await db.serviceOrder.findUniqueOrThrow({ where: { id: fourth } })).status).toBe('RECEIVED');
  });
});
