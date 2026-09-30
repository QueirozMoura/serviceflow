import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, QuoteStatus, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreatedAccount } from '../src/modules/auth/repository.js';
import { QuoteAlreadyExistsError, QuoteInUseError, QuoteNotFoundError, type QuoteRecord, type QuoteRepository } from '../src/modules/quotes/repository.js';
import type { CreateQuoteInput, CreateServiceItemInput, UpdateQuoteInput, UpdateServiceItemInput } from '../src/modules/quotes/schemas.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { buildApp } = await import('../src/app.js');

class MemoryAuthRepository implements AuthRepository {
  private users: AuthUserRecord[] = [];
  private sessions = new Map<string, AuthSessionRecord & { revokedAt?: Date }>();
  private sequence = 0;

  async createOrganizationWithOwner(input: { organizationName: string; slug: string; name: string; email: string; passwordHash: string }): Promise<CreatedAccount> {
    const id = String(++this.sequence);
    const organization = { id: `organization-${id}`, name: input.organizationName, slug: input.slug };
    const user: AuthUserRecord = { id: `user-${id}`, organizationId: organization.id, name: input.name, email: input.email, passwordHash: input.passwordHash, role: UserRole.OWNER, organization };
    this.users.push(user);
    return { user, organization };
  }
  findUsersByEmail(email: string): Promise<AuthUserRecord[]> { return Promise.resolve(this.users.filter((user) => user.email === email)); }
  findUserById(id: string): Promise<AuthUserRecord | null> { return Promise.resolve(this.users.find((user) => user.id === id) ?? null); }
  async createSession(input: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void> {
    const user = this.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error('User not found');
    this.sessions.set(input.tokenHash, { expiresAt: input.expiresAt, user: { id: user.id, organizationId: user.organizationId, role: user.role } });
  }
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> { const session = this.sessions.get(tokenHash); return Promise.resolve(session && !session.revokedAt ? session : null); }
  async revokeSession(tokenHash: string): Promise<void> { const session = this.sessions.get(tokenHash); if (session) session.revokedAt = new Date(); }
}

class MemoryQuoteRepository implements QuoteRepository {
  private quotes: QuoteRecord[] = [];
  private serviceOrders = new Map<string, string>();
  private sequence = 0;

  seedServiceOrder(serviceOrderId: string, organizationId: string): void { this.serviceOrders.set(serviceOrderId, organizationId); }
  serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean> { return Promise.resolve(this.serviceOrders.get(serviceOrderId) === organizationId); }
  findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<QuoteRecord | null> { return Promise.resolve(this.quotes.find((quote) => quote.serviceOrderId === serviceOrderId && this.serviceOrders.get(serviceOrderId) === organizationId) ?? null); }

  async create(organizationId: string, serviceOrderId: string, input: CreateQuoteInput): Promise<QuoteRecord> {
    if (await this.findByServiceOrder(organizationId, serviceOrderId)) throw new QuoteAlreadyExistsError();
    const quote: QuoteRecord = { id: `quote-${++this.sequence}`, serviceOrderId, status: QuoteStatus.PENDING, total: new Prisma.Decimal(0), notes: input.notes ?? null, createdAt: new Date(), updatedAt: new Date(), serviceOrder: { id: serviceOrderId, orderNumber: 'OS-20260930-00000001', status: 'RECEIVED' }, items: [] };
    this.quotes.push(quote);
    return quote;
  }

  async update(organizationId: string, serviceOrderId: string, input: UpdateQuoteInput): Promise<QuoteRecord | null> { const quote = await this.findByServiceOrder(organizationId, serviceOrderId); if (!quote) return null; Object.assign(quote, input, { updatedAt: new Date() }); return quote; }
  async updateStatus(organizationId: string, serviceOrderId: string, status: QuoteStatus): Promise<QuoteRecord | null> { const quote = await this.findByServiceOrder(organizationId, serviceOrderId); if (!quote) return null; quote.status = status; return quote; }
  async delete(organizationId: string, serviceOrderId: string): Promise<boolean> { const quote = await this.findByServiceOrder(organizationId, serviceOrderId); if (!quote) return false; if (quote.items.length) throw new QuoteInUseError(); this.quotes = this.quotes.filter((candidate) => candidate.id !== quote.id); return true; }

  async addItem(organizationId: string, serviceOrderId: string, input: CreateServiceItemInput): Promise<QuoteRecord> {
    const quote = await this.findByServiceOrder(organizationId, serviceOrderId); if (!quote) throw new QuoteNotFoundError();
    quote.items.push({ id: `item-${Date.now()}-${quote.items.length}`, ...input, quantity: new Prisma.Decimal(input.quantity), unitPrice: new Prisma.Decimal(input.unitPrice) });
    this.recalculate(quote); return quote;
  }
  async updateItem(organizationId: string, serviceOrderId: string, itemId: string, input: UpdateServiceItemInput): Promise<QuoteRecord | null> {
    const quote = await this.findByServiceOrder(organizationId, serviceOrderId); if (!quote) return null;
    const item = quote.items.find((candidate) => candidate.id === itemId); if (!item) return null;
    Object.assign(item, input, input.quantity === undefined ? {} : { quantity: new Prisma.Decimal(input.quantity) }, input.unitPrice === undefined ? {} : { unitPrice: new Prisma.Decimal(input.unitPrice) }); this.recalculate(quote); return quote;
  }
  async deleteItem(organizationId: string, serviceOrderId: string, itemId: string): Promise<QuoteRecord | null> { const quote = await this.findByServiceOrder(organizationId, serviceOrderId); if (!quote) return null; const index = quote.items.findIndex((item) => item.id === itemId); if (index < 0) return null; quote.items.splice(index, 1); this.recalculate(quote); return quote; }
  private recalculate(quote: QuoteRecord): void { quote.total = quote.items.reduce((total, item) => total.add(item.quantity.mul(item.unitPrice)), new Prisma.Decimal(0)).toDecimalPlaces(2); }
}

describe('quote routes', () => {
  let app: FastifyInstance;
  let authRepository: MemoryAuthRepository;
  let quoteRepository: MemoryQuoteRepository;
  let sequence = 0;

  beforeEach(async () => { authRepository = new MemoryAuthRepository(); quoteRepository = new MemoryQuoteRepository(); app = buildApp({ authRepository, quoteRepository }); await app.ready(); });
  afterEach(async () => { await app.close(); });

  async function loginForOrganization(name: string) {
    const id = ++sequence;
    const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: name, name: `${name} Owner`, email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `owner-${id}@example.com`, password: 'StrongPass1' } });
    const setCookie = login.headers['set-cookie'];
    return { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0], organizationId: registration.json().user.organizationId as string };
  }

  it('creates, reads, updates, and deletes a quote', async () => {
    const owner = await loginForOrganization('Quotes One'); const serviceOrderId = '11111111-1111-4111-8111-111111111111'; quoteRepository.seedServiceOrder(serviceOrderId, owner.organizationId);
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie }, payload: { notes: 'Orçamento inicial' } });
    const viewed = await app.inject({ method: 'GET', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie }, payload: { notes: 'Atualizado' } });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie } });
    expect(created.statusCode).toBe(201); expect(created.json().quote.status).toBe('PENDING'); expect(created.json().quote.total).toBe('0'); expect(viewed.statusCode).toBe(200); expect(updated.json().quote.notes).toBe('Atualizado'); expect(deleted.statusCode).toBe(204);
  });

  it('isolates quotes and rejects duplicate creation', async () => {
    const first = await loginForOrganization('Quotes Two'); const second = await loginForOrganization('Quotes Three'); const serviceOrderId = '22222222-2222-4222-8222-222222222222'; quoteRepository.seedServiceOrder(serviceOrderId, first.organizationId);
    const other = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: second.cookie }, payload: {} });
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: first.cookie }, payload: {} });
    const duplicate = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: first.cookie }, payload: {} });
    const viewed = await app.inject({ method: 'GET', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: second.cookie } });
    expect(other.statusCode).toBe(404); expect(created.statusCode).toBe(201); expect(duplicate.statusCode).toBe(409); expect(viewed.statusCode).toBe(404);
  });

  it('controls quote status transitions and forbids status in generic patch', async () => {
    const owner = await loginForOrganization('Quotes Four'); const serviceOrderId = '33333333-3333-4333-8333-333333333333'; quoteRepository.seedServiceOrder(serviceOrderId, owner.organizationId); await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie }, payload: {} });
    const approved = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/quote/status`, headers: { cookie: owner.cookie }, payload: { status: 'APPROVED' } });
    const invalid = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/quote/status`, headers: { cookie: owner.cookie }, payload: { status: 'PENDING' } });
    const generic = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie }, payload: { status: 'REJECTED' } });
    expect(approved.statusCode).toBe(200); expect(invalid.statusCode).toBe(409); expect(generic.statusCode).toBe(400);
  });

  it('creates, updates, and removes items while recalculating Decimal totals', async () => {
    const owner = await loginForOrganization('Quotes Five'); const serviceOrderId = '44444444-4444-4444-8444-444444444444'; quoteRepository.seedServiceOrder(serviceOrderId, owner.organizationId); await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie }, payload: {} });
    const created = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote/items`, headers: { cookie: owner.cookie }, payload: { description: 'Peça', quantity: '2', unitPrice: '10.50', type: 'PART' } });
    const itemId = created.json().quote.items[0].id;
    const second = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote/items`, headers: { cookie: owner.cookie }, payload: { description: 'Mão de obra', quantity: '1', unitPrice: '25.00', type: 'LABOR' } });
    const updated = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/quote/items/${itemId}`, headers: { cookie: owner.cookie }, payload: { quantity: '3', unitPrice: '11.00' } });
    const removed = await app.inject({ method: 'DELETE', url: `/api/service-orders/${serviceOrderId}/quote/items/${itemId}`, headers: { cookie: owner.cookie } });
    expect(created.json().quote.total).toBe('21'); expect(second.json().quote.total).toBe('46'); expect(updated.json().quote.total).toBe('58'); expect(removed.json().quote.total).toBe('25');
  });

  it('isolates items, rejects invalid input/internal fields, and requires authentication', async () => {
    const unauthorized = await Promise.all([app.inject({ method: 'POST', url: '/api/service-orders/order-1/quote', payload: {} }), app.inject({ method: 'GET', url: '/api/service-orders/order-1/quote' }), app.inject({ method: 'PATCH', url: '/api/service-orders/order-1/quote', payload: {} }), app.inject({ method: 'DELETE', url: '/api/service-orders/order-1/quote' }), app.inject({ method: 'PATCH', url: '/api/service-orders/order-1/quote/status', payload: { status: 'APPROVED' } }), app.inject({ method: 'POST', url: '/api/service-orders/order-1/quote/items', payload: {} })]);
    const owner = await loginForOrganization('Quotes Six'); const serviceOrderId = '55555555-5555-4555-8555-555555555555'; quoteRepository.seedServiceOrder(serviceOrderId, owner.organizationId); await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie }, payload: {} });
    const invalid = await app.inject({ method: 'POST', url: `/api/service-orders/${serviceOrderId}/quote/items`, headers: { cookie: owner.cookie }, payload: { description: 'X', quantity: '0', unitPrice: '1', type: 'INVALID' } });
    const internal = await app.inject({ method: 'PATCH', url: `/api/service-orders/${serviceOrderId}/quote`, headers: { cookie: owner.cookie }, payload: { total: 100, serviceOrderId: 'other', organizationId: 'other' } });
    expect(unauthorized.every((response) => response.statusCode === 401)).toBe(true); expect(invalid.statusCode).toBe(400); expect(internal.statusCode).toBe(400);
  });
});