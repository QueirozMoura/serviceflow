import { PaymentStatus, Prisma, type Payment, type PrismaClient } from '@prisma/client';
import type { CreatePaymentInput, UpdatePaymentInput } from './schemas.js';

export type PaymentRecord = Pick<Payment, 'id' | 'organizationId' | 'serviceOrderId' | 'amount' | 'status' | 'method' | 'createdAt' | 'updatedAt'> & {
  serviceOrder: { id: string; orderNumber: string; status: string };
};

export interface PaymentRepository {
  serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean>;
  list(organizationId: string, serviceOrderId: string, status?: PaymentStatus): Promise<PaymentRecord[]>;
  findById(organizationId: string, serviceOrderId: string, paymentId: string): Promise<PaymentRecord | null>;
  create(organizationId: string, serviceOrderId: string, input: CreatePaymentInput): Promise<PaymentRecord>;
  update(organizationId: string, serviceOrderId: string, paymentId: string, input: UpdatePaymentInput): Promise<PaymentRecord | null>;
  updateStatus(organizationId: string, serviceOrderId: string, paymentId: string, status: PaymentStatus): Promise<PaymentRecord | null>;
  delete(organizationId: string, serviceOrderId: string, paymentId: string): Promise<boolean>;
}

const paymentInclude = {
  serviceOrder: { select: { id: true, orderNumber: true, status: true } },
} as const;

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly db: PrismaClient) {}

  async serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean> {
    return (await this.db.serviceOrder.findFirst({ where: { id: serviceOrderId, organizationId }, select: { id: true } })) !== null;
  }

  list(organizationId: string, serviceOrderId: string, status?: PaymentStatus): Promise<PaymentRecord[]> {
    return this.db.payment.findMany({ where: { organizationId, serviceOrderId, ...(status ? { status } : {}) }, include: paymentInclude, orderBy: { createdAt: 'desc' } });
  }

  findById(organizationId: string, serviceOrderId: string, paymentId: string): Promise<PaymentRecord | null> {
    return this.db.payment.findFirst({ where: { id: paymentId, organizationId, serviceOrderId }, include: paymentInclude });
  }

  create(organizationId: string, serviceOrderId: string, input: CreatePaymentInput): Promise<PaymentRecord> {
    return this.db.payment.create({ data: { organizationId, serviceOrderId, amount: new Prisma.Decimal(input.amount), method: input.method, status: PaymentStatus.PENDING }, include: paymentInclude });
  }

  async update(organizationId: string, serviceOrderId: string, paymentId: string, input: UpdatePaymentInput): Promise<PaymentRecord | null> {
    const payment = await this.findById(organizationId, serviceOrderId, paymentId);
    if (!payment) return null;
    if (payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.REFUNDED) throw new PaymentImmutableError();
    return this.db.payment.update({ where: { id: payment.id }, data: { ...input, ...(input.amount ? { amount: new Prisma.Decimal(input.amount) } : {}) }, include: paymentInclude });
  }

  async updateStatus(organizationId: string, serviceOrderId: string, paymentId: string, status: PaymentStatus): Promise<PaymentRecord | null> {
    const payment = await this.findById(organizationId, serviceOrderId, paymentId);
    if (!payment) return null;
    return this.db.payment.update({ where: { id: payment.id }, data: { status }, include: paymentInclude });
  }

  async delete(organizationId: string, serviceOrderId: string, paymentId: string): Promise<boolean> {
    const payment = await this.findById(organizationId, serviceOrderId, paymentId);
    if (!payment) return false;
    if (payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.REFUNDED) throw new PaymentImmutableError();
    await this.db.payment.delete({ where: { id: payment.id } });
    return true;
  }
}

export class PaymentImmutableError extends Error {}