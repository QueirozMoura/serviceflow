import type { PaymentMethod, PaymentStatus, Prisma, PrismaClient, QuoteStatus, WarrantyStatus } from '@prisma/client';
import { effectiveWarrantyStatus } from '../warranties/repository.js';

// Listagens agregadas das telas Orcamentos, Pagamentos e Garantias: uma consulta por listagem (sem consulta por OS),
// sempre filtrada pela organizacao da sessao, devolvendo somente os campos que as telas exibem
// (sem e-mail/telefone/documento do cliente, sem itens do orcamento).
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

export interface OverviewRepository {
  listQuotes(organizationId: string): Promise<QuoteOverviewRow[]>;
  listPayments(organizationId: string): Promise<PaymentOverviewRow[]>;
  listWarranties(organizationId: string): Promise<WarrantyOverviewRow[]>;
}

const orderSelect = { select: { id: true, orderNumber: true, customer: { select: { name: true } } } } as const;
// Mesma ordem da lista de OS usada antes pela tela (mais recentes primeiro); o id desempata de forma estavel.
const newestOrderFirst = [{ serviceOrder: { createdAt: 'desc' as const } }, { serviceOrderId: 'asc' as const }];

export class PrismaOverviewRepository implements OverviewRepository {
  constructor(private readonly db: PrismaClient) {}

  async listQuotes(organizationId: string): Promise<QuoteOverviewRow[]> {
    const quotes = await this.db.quote.findMany({
      // Quote nao tem organizationId: o isolamento vem da OS dona do orcamento.
      where: { serviceOrder: { organizationId } },
      orderBy: newestOrderFirst,
      select: { id: true, status: true, total: true, updatedAt: true, _count: { select: { items: true } }, serviceOrder: orderSelect },
    });
    return quotes.map(({ serviceOrder, _count, ...quote }) => ({ serviceOrder, quote: { ...quote, itemsCount: _count.items } }));
  }

  async listPayments(organizationId: string): Promise<PaymentOverviewRow[]> {
    const payments = await this.db.payment.findMany({
      where: { organizationId },
      orderBy: [...newestOrderFirst, { createdAt: 'desc' }],
      select: { id: true, amount: true, status: true, method: true, updatedAt: true, serviceOrder: orderSelect },
    });
    // Agrupa por OS preservando a ordem (pagamentos da mesma OS ja chegam adjacentes e do mais novo ao mais antigo).
    const rows = new Map<string, PaymentOverviewRow>();
    for (const { serviceOrder, ...payment } of payments) {
      const row = rows.get(serviceOrder.id);
      if (row) row.payments.push(payment);
      else rows.set(serviceOrder.id, { serviceOrder, payments: [payment] });
    }
    return [...rows.values()];
  }

  async listWarranties(organizationId: string): Promise<WarrantyOverviewRow[]> {
    const warranties = await this.db.warranty.findMany({
      where: { organizationId },
      orderBy: newestOrderFirst,
      select: { id: true, status: true, startDate: true, endDate: true, description: true, updatedAt: true, serviceOrder: orderSelect },
    });
    // Mesmo status efetivo das demais telas: garantia ACTIVE com data final vencida e exibida como EXPIRED.
    return warranties.map(({ serviceOrder, ...warranty }) => ({ serviceOrder, warranty: { ...warranty, status: effectiveWarrantyStatus(warranty) } }));
  }
}
