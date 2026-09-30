import { Prisma, QuoteStatus, ServiceItemType, WarrantyStatus, type PrismaClient } from '@prisma/client';
import type { MessageType } from './schemas.js';

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

export interface MessageRepository {
  findContext(organizationId: string, serviceOrderId: string, type: MessageType): Promise<MessageContext | null>;
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
}