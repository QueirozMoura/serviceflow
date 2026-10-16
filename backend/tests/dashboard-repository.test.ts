import { describe, expect, it } from 'vitest';
import { PaymentStatus, Prisma, QuoteStatus, type PrismaClient } from '@prisma/client';
import { PrismaDashboardRepository } from '../src/modules/dashboard/repository.js';

type Call = { model: string; method: string; args: { where?: Record<string, unknown> } };

function fakeDatabase(calls: Call[]) {
  const record = (model: string, method: string, result: unknown) => async (args: Call['args']) => { calls.push({ model, method, args }); return result; };
  const transaction = {
    serviceOrder: { groupBy: record('serviceOrder', 'groupBy', [{ status: 'DELIVERED', _count: { _all: 2 } }]), findMany: record('serviceOrder', 'findMany', []) },
    customer: { count: record('customer', 'count', 1) },
    equipment: { count: record('equipment', 'count', 1) },
    quote: { groupBy: record('quote', 'groupBy', [{ status: QuoteStatus.PENDING, _count: { _all: 1 }, _sum: { total: new Prisma.Decimal('100') } }, { status: QuoteStatus.APPROVED, _count: { _all: 1 }, _sum: { total: new Prisma.Decimal('250.5') } }]) },
    payment: { groupBy: record('payment', 'groupBy', [
      { status: PaymentStatus.PAID, _count: { _all: 2 }, _sum: { amount: new Prisma.Decimal('175.75') } },
      { status: PaymentStatus.PENDING, _count: { _all: 1 }, _sum: { amount: new Prisma.Decimal('999') } },
      { status: PaymentStatus.REFUNDED, _count: { _all: 1 }, _sum: { amount: new Prisma.Decimal('50') } },
    ]) },
    warranty: { count: record('warranty', 'count', 0) },
  };
  return { $transaction: (callback: (client: typeof transaction) => unknown) => callback(transaction) } as unknown as PrismaClient;
}

describe('PrismaDashboardRepository', () => {
  it('scopes every query to the organization', async () => {
    const calls: Call[] = [];
    await new PrismaDashboardRepository(fakeDatabase(calls)).getDashboard('organization-1');

    expect(calls.length).toBeGreaterThanOrEqual(9);
    for (const call of calls) expect(JSON.stringify(call.args.where), `${call.model}.${call.method}`).toContain('organization-1');
    expect(JSON.stringify(calls.find((call) => call.model === 'quote')?.args.where)).toBe(JSON.stringify({ serviceOrder: { organizationId: 'organization-1' } }));
  });

  it('adds only PAID payments to paidTotal and keeps decimal precision', async () => {
    const data = await new PrismaDashboardRepository(fakeDatabase([])).getDashboard('organization-1');

    expect(data.payments.paidTotal).toBe('175.75');
    expect(data.payments.byStatus).toMatchObject({ PAID: 2, PENDING: 1, REFUNDED: 1, FAILED: 0, CANCELLED: 0 });
    expect(data.quotes.pendingTotal).toBe('100.00');
    expect(data.quotes.approvedTotal).toBe('250.50');
    expect(data.serviceOrders.total).toBe(2);
  });
});
