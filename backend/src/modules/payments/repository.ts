import { PaymentStatus, Prisma, type Payment, type PrismaClient } from '@prisma/client';
import type { CreatePaymentInput, UpdatePaymentInput } from './schemas.js';

export type PaymentRecord = Pick<Payment, 'id' | 'organizationId' | 'serviceOrderId' | 'amount' | 'status' | 'method' | 'createdAt' | 'updatedAt'> & {
  serviceOrder: { id: string; orderNumber: string; status: string };
};

export interface PaymentRepository {
  serviceOrderBelongsToOrganization(organizationId: string, serviceOrderId: string): Promise<boolean>;
  list(organizationId: string, serviceOrderId: string, status?: PaymentStatus): Promise<PaymentRecord[]>;
  findById(organizationId: string, serviceOrderId: string, paymentId: string): Promise<PaymentRecord | null>;
  /** created=false quando a mesma chave de idempotencia ja havia registrado exatamente este pagamento. */
  create(organizationId: string, serviceOrderId: string, input: CreatePaymentInput, idempotencyKey?: string): Promise<{ payment: PaymentRecord; created: boolean }>;
  update(organizationId: string, serviceOrderId: string, paymentId: string, input: UpdatePaymentInput): Promise<PaymentRecord | null>;
  updateStatus(organizationId: string, serviceOrderId: string, paymentId: string, status: PaymentStatus): Promise<PaymentRecord | null>;
  delete(organizationId: string, serviceOrderId: string, paymentId: string): Promise<boolean>;
}

const paymentInclude = {
  serviceOrder: { select: { id: true, orderNumber: true, status: true } },
} as const;

type Transaction = Prisma.TransactionClient;

const zero = new Prisma.Decimal(0);

// Pagamentos que ocupam saldo: PENDING (registrado, ainda nao confirmado) e PAID. FAILED, CANCELLED e REFUNDED nao contam.
const COUNTED_STATUSES = [PaymentStatus.PENDING, PaymentStatus.PAID];

// Valor devido: o valor final da OS quando informado (> 0); senao o total do orcamento (> 0). Sem nenhum dos dois
// nao ha como afirmar quanto e devido, entao o pagamento nao e limitado (comportamento anterior).
function referenceValue(finalValue: Prisma.Decimal | null, quoteTotal: Prisma.Decimal | null): Prisma.Decimal | null {
  for (const candidate of [finalValue, quoteTotal]) {
    if (candidate !== null && new Prisma.Decimal(candidate).gt(zero)) return new Prisma.Decimal(candidate);
  }
  return null;
}

// Trava a linha da OS (escopada pela organizacao) ate o fim da transacao. Todo pagamento de uma mesma OS passa por
// aqui, entao as checagens de saldo e de idempotencia sao serializadas por OS. E o unico lock tomado por esses
// fluxos, logo nao ha deadlock. Devolve undefined se a OS nao existe na organizacao.
async function lockServiceOrder(transaction: Transaction, organizationId: string, serviceOrderId: string): Promise<{ reference: Prisma.Decimal | null } | undefined> {
  const rows = await transaction.$queryRaw<Array<{ finalValue: Prisma.Decimal | null; quoteTotal: Prisma.Decimal | null }>>(Prisma.sql`
    SELECT so."finalValue" AS "finalValue", q."total" AS "quoteTotal" FROM "ServiceOrder" so
    LEFT JOIN "Quote" q ON q."serviceOrderId" = so."id"
    WHERE so."id" = ${serviceOrderId} AND so."organizationId" = ${organizationId}
    FOR UPDATE OF so`);
  const row = rows[0];
  if (!row) return undefined;
  return { reference: referenceValue(row.finalValue, row.quoteTotal) };
}

async function assertWithinBalance(transaction: Transaction, organizationId: string, serviceOrderId: string, reference: Prisma.Decimal | null, amount: Prisma.Decimal, excludePaymentId?: string): Promise<void> {
  if (reference === null) return;
  const committed = await transaction.payment.aggregate({
    where: { organizationId, serviceOrderId, status: { in: COUNTED_STATUSES }, ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) },
    _sum: { amount: true },
  });
  const outstanding = reference.sub(committed._sum.amount ?? zero);
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

  async create(organizationId: string, serviceOrderId: string, input: CreatePaymentInput, idempotencyKey?: string): Promise<{ payment: PaymentRecord; created: boolean }> {
    const amount = new Prisma.Decimal(input.amount);
    const matches = (existing: PaymentRecord) => existing.serviceOrderId === serviceOrderId && existing.method === input.method && new Prisma.Decimal(existing.amount).equals(amount);
    const replay = async (): Promise<{ payment: PaymentRecord; created: false } | null> => {
      if (!idempotencyKey) return null;
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
        if (idempotencyKey) {
          const existing = await transaction.payment.findFirst({ where: { organizationId, idempotencyKey }, include: paymentInclude });
          if (existing) {
            if (!matches(existing)) throw new PaymentIdempotencyConflictError();
            return { payment: existing, created: false };
          }
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
export class PaymentExceedsBalanceError extends Error {}
export class PaymentIdempotencyConflictError extends Error {}
export class PaymentServiceOrderNotFoundError extends Error {}
