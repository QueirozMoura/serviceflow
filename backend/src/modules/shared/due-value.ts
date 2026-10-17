import { PaymentStatus, Prisma, QuoteStatus } from '@prisma/client';

// Valor devido de uma ordem de servico e a sincronizacao entre quem o define (finalValue, itens e status do orcamento)
// e quem o consome (pagamentos). Todos os caminhos de escrita seguem a MESMA ordem de locks, dentro de uma transacao:
//   1. linha da ordem de servico (lockServiceOrderRow)
//   2. linha do orcamento, quando o caminho altera o orcamento (lockQuoteRow)
// Como todos comecam pela linha da OS, nao ha ordem de locks conflitante e, portanto, nao ha deadlock.

type Transaction = Prisma.TransactionClient;

const zero = new Prisma.Decimal(0);

/** Pagamentos que ocupam saldo. FAILED, CANCELLED e REFUNDED liberam. */
export const RESERVING_STATUSES = [PaymentStatus.PENDING, PaymentStatus.PAID];

/** A alteracao deixaria pagamentos PENDING/PAID acima do valor devido (ou sem valor devido determinavel). */
export class DueValueBelowReservedError extends Error {}

/** Trava a linha da OS (escopada pela organizacao) ate o fim da transacao. false se ela nao existe na organizacao. */
export async function lockServiceOrderRow(transaction: Transaction, organizationId: string, serviceOrderId: string): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT so."id" FROM "ServiceOrder" so WHERE so."id" = ${serviceOrderId} AND so."organizationId" = ${organizationId} FOR UPDATE`);
  return rows.length === 1;
}

/** Trava a linha do orcamento da OS. Chamar somente depois de lockServiceOrderRow. null se nao ha orcamento. */
export async function lockQuoteRow(transaction: Transaction, organizationId: string, serviceOrderId: string): Promise<string | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT q."id" FROM "Quote" q JOIN "ServiceOrder" so ON so."id" = q."serviceOrderId"
    WHERE so."id" = ${serviceOrderId} AND so."organizationId" = ${organizationId} FOR UPDATE OF q`);
  return rows[0]?.id ?? null;
}

/**
 * Valor devido: o valor final da OS quando definido (> 0); senao o total do orcamento da OS (> 0) somente se
 * APPROVED. Orcamento PENDING, REJECTED ou EXPIRED e o valor estimado nunca valem. null = indeterminado.
 */
export function dueValueFrom(finalValue: Prisma.Decimal | null, quoteTotal: Prisma.Decimal | null, quoteStatus: string | null): Prisma.Decimal | null {
  if (finalValue !== null && new Prisma.Decimal(finalValue).gt(zero)) return new Prisma.Decimal(finalValue);
  if (quoteStatus === QuoteStatus.APPROVED && quoteTotal !== null && new Prisma.Decimal(quoteTotal).gt(zero)) return new Prisma.Decimal(quoteTotal);
  return null;
}

/** Le o valor devido vigente. Para ser confiavel, chamar com a linha da OS ja travada nesta transacao. */
export async function readDueValue(transaction: Transaction, organizationId: string, serviceOrderId: string): Promise<Prisma.Decimal | null> {
  const rows = await transaction.$queryRaw<Array<{ finalValue: Prisma.Decimal | null; quoteTotal: Prisma.Decimal | null; quoteStatus: string | null }>>(Prisma.sql`
    SELECT so."finalValue" AS "finalValue", q."total" AS "quoteTotal", q."status"::text AS "quoteStatus" FROM "ServiceOrder" so
    LEFT JOIN "Quote" q ON q."serviceOrderId" = so."id"
    WHERE so."id" = ${serviceOrderId} AND so."organizationId" = ${organizationId}`);
  const row = rows[0];
  return row ? dueValueFrom(row.finalValue, row.quoteTotal, row.quoteStatus) : null;
}

export async function reservedAmount(transaction: Transaction, organizationId: string, serviceOrderId: string, excludePaymentId?: string): Promise<Prisma.Decimal> {
  const sum = await transaction.payment.aggregate({
    where: { organizationId, serviceOrderId, status: { in: RESERVING_STATUSES }, ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) },
    _sum: { amount: true },
  });
  return sum._sum.amount ?? zero;
}

/**
 * Executa `change` (que altera finalValue, itens ou status do orcamento) sob os locks e recusa -- desfazendo tudo --
 * qualquer alteracao que REDUZA ou REMOVA o valor devido a ponto de os pagamentos PENDING/PAID ja existentes o
 * excederem. Alteracoes que mantem ou aumentam o valor devido nunca sao barradas, mesmo em dados legados que ja
 * estavam acima do devido (nada e recalculado nem apagado). Chamar dentro de uma transacao, depois de lockServiceOrderRow.
 */
export async function guardDueValueChange<T>(transaction: Transaction, organizationId: string, serviceOrderId: string, change: () => Promise<T>): Promise<T> {
  const before = await readDueValue(transaction, organizationId, serviceOrderId);
  const result = await change();
  const after = await readDueValue(transaction, organizationId, serviceOrderId);
  const lowered = before !== null && (after === null || after.lt(before));
  if (lowered) {
    const reserved = await reservedAmount(transaction, organizationId, serviceOrderId);
    if (reserved.gt(zero) && (after === null || reserved.gt(after))) throw new DueValueBelowReservedError();
  }
  return result;
}
