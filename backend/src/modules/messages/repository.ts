import { Prisma, QuoteStatus, ServiceItemType, WarrantyStatus, type PrismaClient } from '@prisma/client';
import type { MessageChannel, MessageType } from './schemas.js';

export type MessageContext = {
  id: string;
  orderNumber: string;
  customer: { name: string; phone: string };
  equipment: { type: string; brand: string | null; model: string | null };
  diagnosis?: { description: string } | null;
  quote?: {
    status: QuoteStatus;
    total: Prisma.Decimal;
    items: Array<{ description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; type: ServiceItemType }>;
  } | null;
  warranty?: { status: WarrantyStatus; startDate: Date; endDate: Date; description: string } | null;
};

// Historico persistido. Hoje todo registro e DRAFT: gravado no sistema, nunca enviado por ele (nao ha provedor).
export type MessageHistoryRecord = {
  id: string;
  serviceOrderId: string;
  type: MessageType;
  channel: MessageChannel;
  status: 'DRAFT';
  content: string;
  createdAt: Date;
  createdBy: { name: string };
  recipient: { name: string };
};

export type CreateMessageHistoryInput = {
  organizationId: string;
  createdByUserId: string;
  serviceOrderId: string;
  type: MessageType;
  channel: MessageChannel;
  content: string;
  idempotencyKey?: string;
};

export interface MessageRepository {
  findContext(organizationId: string, serviceOrderId: string, type: MessageType): Promise<MessageContext | null>;
  /** null quando a OS nao pertence a organizacao. */
  listHistory(organizationId: string, serviceOrderId: string): Promise<MessageHistoryRecord[] | null>;
  findHistoryByKey(organizationId: string, idempotencyKey: string): Promise<MessageHistoryRecord | null>;
  /** null quando a OS nao pertence a organizacao; created=false quando a mesma chave de idempotencia ja existia. */
  createHistory(input: CreateMessageHistoryInput): Promise<{ record: MessageHistoryRecord; created: boolean } | null>;
}

export class RecipientChannelUnavailableError extends Error {
  constructor(readonly channel: MessageChannel) {
    super(`Customer has no destination for channel ${channel}`);
    this.name = 'RecipientChannelUnavailableError';
  }
}

const historySelect = {
  id: true, serviceOrderId: true, type: true, channel: true, status: true, content: true, createdAt: true,
  createdBy: { select: { name: true } },
  customer: { select: { name: true } },
} as const;

function presentHistory({ customer, ...row }: Prisma.MessageGetPayload<{ select: typeof historySelect }>): MessageHistoryRecord {
  return { ...row, recipient: { name: customer.name } };
}

const baseSelect = {
  id: true,
  orderNumber: true,
  customer: { select: { name: true, phone: true } },
  equipment: { select: { type: true, brand: true, model: true } },
} as const;

export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly db: PrismaClient) {}

  async findContext(organizationId: string, serviceOrderId: string, type: MessageType): Promise<MessageContext | null> {
    const serviceOrder = await this.db.serviceOrder.findFirst({ where: { id: serviceOrderId, organizationId }, select: baseSelect });
    if (!serviceOrder) return null;

    const context: MessageContext = { ...serviceOrder };
    if (type === 'DIAGNOSIS_READY') {
      context.diagnosis = await this.db.diagnosis.findUnique({ where: { serviceOrderId }, select: { description: true } });
    }
    if (type === 'QUOTE_READY' || type === 'QUOTE_APPROVED') {
      context.quote = await this.db.quote.findUnique({ where: { serviceOrderId }, select: { status: true, total: true, items: { select: { description: true, quantity: true, unitPrice: true, type: true }, orderBy: { id: 'asc' } } } });
    }
    if (type === 'WARRANTY_CREATED') {
      context.warranty = await this.db.warranty.findUnique({ where: { serviceOrderId }, select: { status: true, startDate: true, endDate: true, description: true } });
    }
    return context;
  }

  async listHistory(organizationId: string, serviceOrderId: string): Promise<MessageHistoryRecord[] | null> {
    const serviceOrder = await this.db.serviceOrder.findFirst({ where: { id: serviceOrderId, organizationId }, select: { id: true } });
    if (!serviceOrder) return null;
    const rows = await this.db.message.findMany({ where: { organizationId, serviceOrderId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: historySelect });
    return rows.map(presentHistory);
  }

  async findHistoryByKey(organizationId: string, idempotencyKey: string): Promise<MessageHistoryRecord | null> {
    const row = await this.db.message.findFirst({ where: { organizationId, idempotencyKey }, select: historySelect });
    return row ? presentHistory(row) : null;
  }

  async createHistory(input: CreateMessageHistoryInput): Promise<{ record: MessageHistoryRecord; created: boolean } | null> {
    // A OS e o destinatario saem sempre do banco, filtrados pela organizacao da sessao.
    const serviceOrder = await this.db.serviceOrder.findFirst({ where: { id: input.serviceOrderId, organizationId: input.organizationId }, select: { customerId: true, customer: { select: { email: true } } } });
    if (!serviceOrder) return null;
    if (input.channel === 'EMAIL' && !serviceOrder.customer.email) throw new RecipientChannelUnavailableError('EMAIL');
    try {
      const row = await this.db.message.create({
        data: {
          organizationId: input.organizationId, serviceOrderId: input.serviceOrderId, customerId: serviceOrder.customerId, createdByUserId: input.createdByUserId,
          type: input.type, channel: input.channel, status: 'DRAFT', content: input.content, idempotencyKey: input.idempotencyKey ?? null,
        },
        select: historySelect,
      });
      return { record: presentHistory(row), created: true };
    } catch (error) {
      // Requisicao repetida em paralelo com a mesma chave: devolve o registro que ganhou a corrida.
      if (input.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findHistoryByKey(input.organizationId, input.idempotencyKey);
        if (existing) return { record: existing, created: false };
      }
      throw error;
    }
  }
}