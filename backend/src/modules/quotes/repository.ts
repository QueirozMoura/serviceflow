import { Prisma, QuoteStatus, type PrismaClient, type Quote, type ServiceItem } from '@prisma/client';
import { guardDueValueChange, lockQuoteRow, lockServiceOrderRow } from '../shared/due-value.js';
import { isForeignKeyRestriction } from '../service-orders/repository.js';
import type { CreateQuoteInput, CreateServiceItemInput, UpdateQuoteInput, UpdateServiceItemInput } from './schemas.js';

export type QuoteRecord = Pick<Quote, 'id' | 'serviceOrderId' | 'status' | 'total' | 'notes' | 'createdAt' | 'updatedAt'> & {
  serviceOrder: { id: string; orderNumber: string; status: string };
  items: Array<Pick<ServiceItem, 'id' | 'description' | 'quantity' | 'unitPrice' | 'type'>>;
};

export interface QuoteRepository {
  serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean>;
  findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<QuoteRecord | null>;
  create(organizationId: string, serviceOrderId: string, input: CreateQuoteInput): Promise<QuoteRecord>;
  update(organizationId: string, serviceOrderId: string, input: UpdateQuoteInput): Promise<QuoteRecord | null>;
  updateStatus(organizationId: string, serviceOrderId: string, status: QuoteStatus): Promise<QuoteRecord | null>;
  delete(organizationId: string, serviceOrderId: string): Promise<boolean>;
  addItem(organizationId: string, serviceOrderId: string, input: CreateServiceItemInput): Promise<QuoteRecord>;
  updateItem(organizationId: string, serviceOrderId: string, itemId: string, input: UpdateServiceItemInput): Promise<QuoteRecord | null>;
  deleteItem(organizationId: string, serviceOrderId: string, itemId: string): Promise<QuoteRecord | null>;
}

const quoteInclude = {
  serviceOrder: { select: { id: true, orderNumber: true, status: true } },
  items: { select: { id: true, description: true, quantity: true, unitPrice: true, type: true }, orderBy: { id: 'asc' as const } },
} as const;

function calculateTotal(items: Array<{ quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }>): Prisma.Decimal {
  return items.reduce((total, item) => total.add(item.quantity.mul(item.unitPrice)), new Prisma.Decimal(0)).toDecimalPlaces(2);
}

type Transaction = Prisma.TransactionClient;

// Serializa as mutacoes de itens de um mesmo orcamento seguindo a ordem global de locks (OS e depois orcamento, ver
// shared/due-value): cada uma le os itens ja confirmados pelas anteriores e grava um total que reflete a soma real.
async function lockQuote(transaction: Transaction, organizationId: string, serviceOrderId: string): Promise<string | null> {
  if (!(await lockServiceOrderRow(transaction, organizationId, serviceOrderId))) return null;
  return lockQuoteRow(transaction, organizationId, serviceOrderId);
}

async function refreshTotal(transaction: Transaction, quoteId: string): Promise<QuoteRecord> {
  const items = await transaction.serviceItem.findMany({ where: { quoteId } });
  await transaction.quote.update({ where: { id: quoteId }, data: { total: calculateTotal(items) } });
  return transaction.quote.findUniqueOrThrow({ where: { id: quoteId }, include: quoteInclude });
}

export class PrismaQuoteRepository implements QuoteRepository {
  constructor(private readonly db: PrismaClient) {}

  async serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean> {
    return (await this.db.serviceOrder.findFirst({ where: { id: serviceOrderId, organizationId }, select: { id: true } })) !== null;
  }

  findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<QuoteRecord | null> {
    return this.db.quote.findFirst({ where: { serviceOrder: { id: serviceOrderId, organizationId } }, include: quoteInclude });
  }

  async create(organizationId: string, serviceOrderId: string, input: CreateQuoteInput): Promise<QuoteRecord> {
    try {
      return await this.db.quote.create({ data: { serviceOrderId, status: QuoteStatus.PENDING, total: new Prisma.Decimal(0), ...input }, include: quoteInclude });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new QuoteAlreadyExistsError();
      throw error;
    }
  }

  async update(organizationId: string, serviceOrderId: string, input: UpdateQuoteInput): Promise<QuoteRecord | null> {
    const quote = await this.findByServiceOrder(organizationId, serviceOrderId);
    if (!quote) return null;
    return this.db.quote.update({ where: { id: quote.id }, data: input, include: quoteInclude });
  }

  async updateStatus(organizationId: string, serviceOrderId: string, status: QuoteStatus): Promise<QuoteRecord | null> {
    return this.db.$transaction(async (transaction) => {
      const quoteId = await lockQuote(transaction, organizationId, serviceOrderId);
      if (!quoteId) return null;
      // Relido sob o lock: duas decisoes simultaneas (ex.: aprovar e rejeitar) nao podem ambas vencer.
      const current = await transaction.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } });
      if (!QUOTE_TRANSITIONS[current.status].includes(status)) throw new QuoteTransitionError();
      return guardDueValueChange(transaction, organizationId, serviceOrderId, async () => {
        await transaction.quote.update({ where: { id: quoteId }, data: { status } });
        return transaction.quote.findUniqueOrThrow({ where: { id: quoteId }, include: quoteInclude });
      });
    });
  }

  async delete(organizationId: string, serviceOrderId: string): Promise<boolean> {
    const quote = await this.findByServiceOrder(organizationId, serviceOrderId);
    if (!quote) return false;
    try {
      await this.db.quote.delete({ where: { id: quote.id } });
      return true;
    } catch (error) {
      if (isForeignKeyRestriction(error)) throw new QuoteInUseError();
      throw error;
    }
  }

  async addItem(organizationId: string, serviceOrderId: string, input: CreateServiceItemInput): Promise<QuoteRecord> {
    return this.db.$transaction(async (transaction) => {
      const quoteId = await lockQuote(transaction, organizationId, serviceOrderId);
      if (!quoteId) throw new QuoteNotFoundError();
      return guardDueValueChange(transaction, organizationId, serviceOrderId, async () => {
        await transaction.serviceItem.create({ data: { quoteId, ...input } });
        return refreshTotal(transaction, quoteId);
      });
    });
  }

  async updateItem(organizationId: string, serviceOrderId: string, itemId: string, input: UpdateServiceItemInput): Promise<QuoteRecord | null> {
    return this.db.$transaction(async (transaction) => {
      const quoteId = await lockQuote(transaction, organizationId, serviceOrderId);
      if (!quoteId) return null;
      const item = await transaction.serviceItem.findFirst({ where: { id: itemId, quoteId } });
      if (!item) return null;
      return guardDueValueChange(transaction, organizationId, serviceOrderId, async () => {
        await transaction.serviceItem.update({ where: { id: itemId }, data: input });
        return refreshTotal(transaction, quoteId);
      });
    });
  }

  async deleteItem(organizationId: string, serviceOrderId: string, itemId: string): Promise<QuoteRecord | null> {
    return this.db.$transaction(async (transaction) => {
      const quoteId = await lockQuote(transaction, organizationId, serviceOrderId);
      if (!quoteId) return null;
      const item = await transaction.serviceItem.findFirst({ where: { id: itemId, quoteId } });
      if (!item) return null;
      return guardDueValueChange(transaction, organizationId, serviceOrderId, async () => {
        await transaction.serviceItem.delete({ where: { id: itemId } });
        return refreshTotal(transaction, quoteId);
      });
    });
  }
}

/** Unica fonte das transicoes de status do orcamento: so um orcamento PENDING pode ser decidido. */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = { PENDING: [QuoteStatus.APPROVED, QuoteStatus.REJECTED, QuoteStatus.EXPIRED], APPROVED: [], REJECTED: [], EXPIRED: [] };
export class QuoteTransitionError extends Error {}
export class QuoteAlreadyExistsError extends Error {}
export class QuoteNotFoundError extends Error {}
export class QuoteInUseError extends Error {}