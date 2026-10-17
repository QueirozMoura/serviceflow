import { PaymentStatus, Prisma, type Payment, type PrismaClient } from '@prisma/client';
import { lockServiceOrderRow, readDueValue, reservedAmount } from '../shared/due-value.js';
import type { CreatePaymentInput, UpdatePaymentInput } from './schemas.js';

export type PaymentRecord = Pick<Payment, 'id' | 'organizationId' | 'serviceOrderId' | 'amount' | 'status' | 'method' | 'createdAt' | 'updatedAt'> & {
  serviceOrder: { id: string; orderNumber: string; status: string };
};

export interface PaymentRepository {
  serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean>;
  list(organizationId: string, serviceOrderId: string, status?: PaymentStatus): Promise<PaymentRecord[]>;
  findById(organizationId: string, serviceOrderId: string, paymentId: string): Promise<PaymentRecord | null>;
  /** created=false quando a mesma chave de idempotencia ja havia registrado exatamente este pagamento. */
  create(organizationId: string, serviceOrderId: string, input: CreatePaymentInput, idempotencyKey: string): Promise<{ payment: PaymentRecord; created: boolean }>;
  update(organizationId: string, serviceOrderId: string, paymentId: string, input: UpdatePaymentInput): Promise<PaymentRecord | null>;
  updateStatus(organizationId: string, serviceOrderId: string, paymentId: string, status: PaymentStatus): Promise<PaymentRecord | null>;
  delete(organizationId: string, serviceOrderId: string, paymentId: string): Promise<boolean>;
}

const paymentInclude = {
  serviceOrder: { select: { id: true, orderNumber: true, status: true } },
} as const;

/** Unica fonte das transicoes permitidas; so PENDING->PAID mantem o saldo ocupado, as demais o liberam. */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = { PENDING: [PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.CANCELLED], PAID: [PaymentStatus.REFUNDED], FAILED: [], CANCELLED: [], REFUNDED: [] };

type Transaction = Prisma.TransactionClient;

// Trava a linha da OS e le o valor devido vigente (null = indeterminado). Todo fluxo que cria, edita, remove ou muda o
// status de um pagamento passa por aqui; os caminhos que alteram o valor devido usam o mesmo lock (ver shared/due-value).
async function lockServiceOrder(transaction: Transaction, organizationId: string, serviceOrderId: string): Promise<{ reference: Prisma.Decimal | null } | undefined> {
  if (!(await lockServiceOrderRow(transaction, organizationId, serviceOrderId))) return undefined;
  return { reference: await readDueValue(transaction, organizationId, serviceOrderId) };
}

async function assertWithinBalance(transaction: Transaction, organizationId: string, serviceOrderId: string, reference: Prisma.Decimal | null, amount: Prisma.Decimal, excludePaymentId?: string): Promise<void> {
  if (reference === null) throw new PaymentDueAmountUnknownError();
  const outstanding = reference.sub(await reservedAmount(transaction, organizationId, serviceOrderId, excludePaymentId));
  if (amount.gt(outstanding)) throw new PaymentExceedsBalanceError();
}

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

  async create(organizationId: string, serviceOrderId: string, input: CreatePaymentInput, idempotencyKey: string): Promise<{ payment: PaymentRecord; created: boolean }> {
    const amount = new Prisma.Decimal(input.amount);
    const matches = (existing: PaymentRecord) => existing.serviceOrderId === serviceOrderId && existing.method === input.method && new Prisma.Decimal(existing.amount).equals(amount);
    const replay = async (): Promise<{ payment: PaymentRecord; created: false } | null> => {
      const existing = await this.db.payment.findFirst({ where: { organizationId, idempotencyKey }, include: paymentInclude });
      if (!existing) return null;
      if (!matches(existing)) throw new PaymentIdempotencyConflictError();
      return { payment: existing, created: false };
    };

    try {
      return await this.db.$transaction(async (transaction) => {
        const locked = await lockServiceOrder(transaction, organizationId, serviceOrderId);
        if (!locked) throw new PaymentServiceOrderNotFoundError();
        // Repeticao confirmada da mesma operacao: devolve o registro original, sem rechecar saldo (ele ja esta contado).
        const existing = await transaction.payment.findFirst({ where: { organizationId, idempotencyKey }, include: paymentInclude });
        if (existing) {
          if (!matches(existing)) throw new PaymentIdempotencyConflictError();
          return { payment: existing, created: false };
        }
        await assertWithinBalance(transaction, organizationId, serviceOrderId, locked.reference, amount);
        const payment = await transaction.payment.create({ data: { organizationId, serviceOrderId, amount, method: input.method, status: PaymentStatus.PENDING, idempotencyKey }, include: paymentInclude });
        return { payment, created: true };
      });
    } catch (error) {
      // Mesma chave usada em OS diferentes (travas distintas) ao mesmo tempo: o indice unico decide e o perdedor reavalia.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await replay();
        if (existing) return existing;
      }
      throw error;
    }
  }

  async update(organizationId: string, serviceOrderId: string, paymentId: string, input: UpdatePaymentInput): Promise<PaymentRecord | null> {
    return this.db.$transaction(async (transaction) => {
      const locked = await lockServiceOrder(transaction, organizationId, serviceOrderId);
      if (!locked) return null;
      const payment = await transaction.payment.findFirst({ where: { id: paymentId, organizationId, serviceOrderId }, include: paymentInclude });
      if (!payment) return null;
      if (payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.REFUNDED) throw new PaymentImmutableError();
      const { amount: rawAmount, ...rest } = input;
      const amount = rawAmount === undefined ? undefined : new Prisma.Decimal(rawAmount);
      // Pagamento pendente conta no saldo; ao aumentar o valor ele nao pode estourar o que resta (excluindo ele mesmo).
      if (amount && payment.status === PaymentStatus.PENDING) await assertWithinBalance(transaction, organizationId, serviceOrderId, locked.reference, amount, payment.id);
      return transaction.payment.update({ where: { id: payment.id }, data: { ...rest, ...(amount ? { amount } : {}) }, include: paymentInclude });
    });
  }

  async updateStatus(organizationId: string, serviceOrderId: string, paymentId: string, status: PaymentStatus): Promise<PaymentRecord | null> {
    return this.db.$transaction(async (transaction) => {
      if (!(await lockServiceOrder(transaction, organizationId, serviceOrderId))) return null;
      // Relido sob o lock: a transicao e validada contra o estado real, nao contra uma leitura anterior.
      const payment = await transaction.payment.findFirst({ where: { id: paymentId, organizationId, serviceOrderId } });
      if (!payment) return null;
      if (!PAYMENT_TRANSITIONS[payment.status].includes(status)) throw new PaymentTransitionError();
      const result = await transaction.payment.updateMany({ where: { id: payment.id, organizationId, status: payment.status }, data: { status } });
      if (result.count !== 1) throw new PaymentTransitionError();
      return transaction.payment.findFirstOrThrow({ where: { id: payment.id, organizationId }, include: paymentInclude });
    });
  }

  async delete(organizationId: string, serviceOrderId: string, paymentId: string): Promise<boolean> {
    return this.db.$transaction(async (transaction) => {
      if (!(await lockServiceOrder(transaction, organizationId, serviceOrderId))) return false;
      const payment = await transaction.payment.findFirst({ where: { id: paymentId, organizationId, serviceOrderId } });
      if (!payment) return false;
      if (payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.REFUNDED) throw new PaymentImmutableError();
      await transaction.payment.deleteMany({ where: { id: payment.id, organizationId, status: payment.status } });
      return true;
    });
  }
}

export class PaymentImmutableError extends Error {}
export class PaymentExceedsBalanceError extends Error {}
export class PaymentIdempotencyConflictError extends Error {}
export class PaymentServiceOrderNotFoundError extends Error {}
export class PaymentDueAmountUnknownError extends Error {}
export class PaymentTransitionError extends Error {}
