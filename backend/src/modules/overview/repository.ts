import { PaymentStatus, Prisma, QuoteStatus, WarrantyStatus, type PaymentMethod, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { effectiveWarrantyStatus } from '../warranties/repository.js';
import { containsInsensitive, pageQueryShape, searchTermSchema, skipTake, type Page, type PageQuery } from '../shared/pagination.js';

// Listagens agregadas das telas Orcamentos, Pagamentos e Garantias: paginadas no banco (uma linha por OS), filtradas
// pela organizacao da sessao e com somente os campos exibidos (sem e-mail/telefone/documento do cliente).
export const listQuotesQuerySchema = z.object({ ...pageQueryShape, q: searchTermSchema, status: z.nativeEnum(QuoteStatus).optional() });
export const listPaymentsQuerySchema = z.object({ ...pageQueryShape, q: searchTermSchema, status: z.nativeEnum(PaymentStatus).optional() });
export const listWarrantiesQuerySchema = z.object({ ...pageQueryShape, q: searchTermSchema, status: z.nativeEnum(WarrantyStatus).optional() });

export type OverviewQuery<S> = PageQuery & { q?: string; status?: S };

export type OverviewOrder = { id: string; orderNumber: string; customer: { name: string } };

export type QuoteOverviewRow = {
  serviceOrder: OverviewOrder;
  quote: { id: string; status: QuoteStatus; total: Prisma.Decimal; itemsCount: number; updatedAt: Date };
};
export type PaymentOverviewRow = {
  serviceOrder: OverviewOrder;
  payments: Array<{ id: string; amount: Prisma.Decimal; status: PaymentStatus; method: PaymentMethod; updatedAt: Date }>;
};
export type WarrantyOverviewRow = {
  serviceOrder: OverviewOrder;
  warranty: { id: string; status: WarrantyStatus; startDate: Date; endDate: Date; description: string; updatedAt: Date };
};

// Totais dos cartoes do topo: calculados no banco sobre TODA a organizacao (ignoram busca/filtro, como antes no navegador).
export type QuoteSummary = { pendingCount: number; approvedTotal: string; totalValue: string };
export type PaymentSummary = { paidTotal: string; pendingTotal: string; count: number };
export type WarrantySummary = { active: number; expired: number; total: number };

export type OverviewPage<Row, Summary> = Page<Row> & { summary: Summary };

export interface OverviewRepository {
  listQuotes(organizationId: string, query: OverviewQuery<QuoteStatus>): Promise<OverviewPage<QuoteOverviewRow, QuoteSummary>>;
  listPayments(organizationId: string, query: OverviewQuery<PaymentStatus>): Promise<OverviewPage<PaymentOverviewRow, PaymentSummary>>;
  listWarranties(organizationId: string, query: OverviewQuery<WarrantyStatus>): Promise<OverviewPage<WarrantyOverviewRow, WarrantySummary>>;
}

const orderSelect = { select: { id: true, orderNumber: true, customer: { select: { name: true } } } } as const;
// Mesma ordem da lista de OS (mais recentes primeiro); o id desempata de forma estavel.
const newestOrderFirst = [{ createdAt: 'desc' as const }, { id: 'asc' as const }];
const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);

/** Busca por numero da OS ou nome do cliente, aplicada a OS dona do registro. */
function orderSearch(term: string | undefined) {
  return term ? { OR: [{ orderNumber: containsInsensitive(term) }, { customer: { name: containsInsensitive(term) } }] } : {};
}

export class PrismaOverviewRepository implements OverviewRepository {
  constructor(private readonly db: PrismaClient) {}

  async listQuotes(organizationId: string, query: OverviewQuery<QuoteStatus>): Promise<OverviewPage<QuoteOverviewRow, QuoteSummary>> {
    // Quote nao tem organizationId: o isolamento vem da OS dona do orcamento.
    const where = { serviceOrder: { organizationId, ...orderSearch(query.q) }, ...(query.status ? { status: query.status } : {}) };
    const [quotes, total, groups] = await this.db.$transaction([
      this.db.quote.findMany({
        where,
        orderBy: [{ serviceOrder: { createdAt: 'desc' } }, { serviceOrderId: 'asc' }],
        ...skipTake(query),
        select: { id: true, status: true, total: true, updatedAt: true, _count: { select: { items: true } }, serviceOrder: orderSelect },
      }),
      this.db.quote.count({ where }),
      this.db.quote.groupBy({ by: ['status'], where: { serviceOrder: { organizationId } }, orderBy: { status: 'asc' }, _count: { _all: true }, _sum: { total: true } }),
    ]);
    let totalValue = new Prisma.Decimal(0);
    let approvedTotal = new Prisma.Decimal(0);
    let pendingCount = 0;
    for (const group of groups) {
      const sum = group._sum?.total ?? new Prisma.Decimal(0);
      totalValue = totalValue.add(sum);
      if (group.status === QuoteStatus.APPROVED) approvedTotal = sum;
      if (group.status === QuoteStatus.PENDING) pendingCount = (group._count as { _all: number })._all;
    }
    return {
      items: quotes.map(({ serviceOrder, _count, ...quote }) => ({ serviceOrder, quote: { ...quote, itemsCount: _count.items } })),
      total,
      summary: { pendingCount, approvedTotal: money(approvedTotal), totalValue: money(totalValue) },
    };
  }

  async listPayments(organizationId: string, query: OverviewQuery<PaymentStatus>): Promise<OverviewPage<PaymentOverviewRow, PaymentSummary>> {
    // Pagina por OS com ao menos um pagamento (do status filtrado, se houver); cada linha traz todos os pagamentos da OS.
    const where = { organizationId, payments: { some: { organizationId, ...(query.status ? { status: query.status } : {}) } }, ...orderSearch(query.q) };
    const [orders, total, groups] = await this.db.$transaction([
      this.db.serviceOrder.findMany({
        where,
        orderBy: newestOrderFirst,
        ...skipTake(query),
        select: { id: true, orderNumber: true, customer: { select: { name: true } }, payments: { where: { organizationId }, orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, status: true, method: true, updatedAt: true } } },
      }),
      this.db.serviceOrder.count({ where }),
      this.db.payment.groupBy({ by: ['status'], where: { organizationId }, orderBy: { status: 'asc' }, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    let paidTotal = new Prisma.Decimal(0);
    let pendingTotal = new Prisma.Decimal(0);
    let count = 0;
    for (const group of groups) {
      count += (group._count as { _all: number })._all;
      // Somente pagamentos efetivamente pagos entram em "Recebido"; pendentes ficam a parte.
      if (group.status === PaymentStatus.PAID) paidTotal = group._sum?.amount ?? paidTotal;
      if (group.status === PaymentStatus.PENDING) pendingTotal = group._sum?.amount ?? pendingTotal;
    }
    return {
      items: orders.map(({ payments, ...serviceOrder }) => ({ serviceOrder, payments })),
      total,
      summary: { paidTotal: money(paidTotal), pendingTotal: money(pendingTotal), count },
    };
  }

  async listWarranties(organizationId: string, query: OverviewQuery<WarrantyStatus>): Promise<OverviewPage<WarrantyOverviewRow, WarrantySummary>> {
    const now = new Date();
    // Status efetivo, igual ao das demais telas: ACTIVE com data final vencida conta como EXPIRED.
    const effective = {
      [WarrantyStatus.ACTIVE]: { status: WarrantyStatus.ACTIVE, endDate: { gt: now } },
      [WarrantyStatus.EXPIRED]: { OR: [{ status: WarrantyStatus.EXPIRED }, { status: WarrantyStatus.ACTIVE, endDate: { lte: now } }] },
      [WarrantyStatus.CANCELLED]: { status: WarrantyStatus.CANCELLED },
    } satisfies Record<WarrantyStatus, Prisma.WarrantyWhereInput>;
    const where: Prisma.WarrantyWhereInput = { organizationId, serviceOrder: orderSearch(query.q), ...(query.status ? effective[query.status] : {}) };
    const [warranties, total, active, expired, all] = await this.db.$transaction([
      this.db.warranty.findMany({
        where,
        orderBy: [{ serviceOrder: { createdAt: 'desc' } }, { serviceOrderId: 'asc' }],
        ...skipTake(query),
        select: { id: true, status: true, startDate: true, endDate: true, description: true, updatedAt: true, serviceOrder: orderSelect },
      }),
      this.db.warranty.count({ where }),
      this.db.warranty.count({ where: { organizationId, ...effective.ACTIVE } }),
      this.db.warranty.count({ where: { organizationId, ...effective.EXPIRED } }),
      this.db.warranty.count({ where: { organizationId } }),
    ]);
    return {
      items: warranties.map(({ serviceOrder, ...warranty }) => ({ serviceOrder, warranty: { ...warranty, status: effectiveWarrantyStatus(warranty, now) } })),
      total,
      summary: { active, expired, total: all },
    };
  }
}
