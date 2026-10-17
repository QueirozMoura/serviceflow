import { PaymentStatus, Prisma, QuoteStatus, ServiceOrderStatus, type PrismaClient, type ServiceOrder } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { containsInsensitive, newestFirst, skipTake, type Page } from '../shared/pagination.js';
import { guardDueValueChange, lockEditableServiceOrder, lockQuoteRow, lockServiceOrderRow, readDueValue } from '../shared/due-value.js';
import { FinancialChangeForbiddenError, InvalidStatusTransitionError, OpenBalanceError, PaidPaymentsError, QuoteNotApprovedError, SERVICE_ORDER_TRANSITIONS } from '../shared/lifecycle.js';
import type { CreateServiceOrderInput, ListServiceOrdersQuery, UpdateServiceOrderInput } from './schemas.js';

export type ServiceOrderRecord = Pick<
  ServiceOrder,
  'id' | 'organizationId' | 'customerId' | 'equipmentId' | 'orderNumber' | 'status' | 'problemDescription' | 'technicianNotes' | 'estimatedValue' | 'finalValue' | 'receivedAt' | 'completedAt' | 'createdAt' | 'updatedAt'
> & {
  customer: { id: string; name: string };
  equipment: { id: string; type: string; brand: string | null; model: string | null };
};

export interface ServiceOrderRepository {
  referencesBelongToOrganization(organizationId: string, customerId: string, equipmentId: string): Promise<boolean>;
  create(organizationId: string, changedByUserId: string, input: CreateServiceOrderInput): Promise<ServiceOrderRecord>;
  list(organizationId: string, query: ListServiceOrdersQuery): Promise<Page<ServiceOrderRecord>>;
  findById(organizationId: string, id: string): Promise<ServiceOrderRecord | null>;
  /** options.canEditValues: o usuario pode alterar estimatedValue/finalValue (padrao: nao). */
  update(organizationId: string, id: string, input: UpdateServiceOrderInput, options?: { canEditValues?: boolean }): Promise<ServiceOrderRecord | null>;
  updateStatus(organizationId: string, id: string, changedByUserId: string, status: ServiceOrderStatus): Promise<ServiceOrderRecord | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

const orderInclude = {
  customer: { select: { id: true, name: true } },
  equipment: { select: { id: true, type: true, brand: true, model: true } },
} as const;

// FKs com ON DELETE RESTRICT geram SQLSTATE 23001, que o Prisma nao converte em P2003 (so 23503 vira P2003).
export function isForeignKeyRestriction(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2003';
  return error instanceof Prisma.PrismaClientUnknownRequestError && /code: "23001"|violates RESTRICT setting of foreign key constraint/.test(error.message);
}

function generateOrderNumber(): string {
  return `OS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

// Pre-condicoes de negocio por destino, avaliadas com a OS travada. Ordem de locks: OS e, se preciso, orcamento.
async function assertTransitionPreconditions(transaction: Prisma.TransactionClient, organizationId: string, id: string, status: ServiceOrderStatus): Promise<void> {
  if (status === ServiceOrderStatus.APPROVED) {
    // Com orcamento, ele precisa estar aprovado. Sem orcamento a regra atual (aprovar direto) e mantida.
    const quoteId = await lockQuoteRow(transaction, organizationId, id);
    if (quoteId) {
      const quote = await transaction.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } });
      if (quote.status !== QuoteStatus.APPROVED) throw new QuoteNotApprovedError();
    }
  }
  if (status === ServiceOrderStatus.DELIVERED) {
    const pending = await transaction.payment.count({ where: { organizationId, serviceOrderId: id, status: PaymentStatus.PENDING } });
    if (pending > 0) throw new OpenBalanceError();
    const due = await readDueValue(transaction, organizationId, id);
    if (due !== null) {
      const paid = (await transaction.payment.aggregate({ where: { organizationId, serviceOrderId: id, status: PaymentStatus.PAID }, _sum: { amount: true } }))._sum.amount ?? new Prisma.Decimal(0);
      if (paid.lt(due)) throw new OpenBalanceError();
    }
  }
  if (status === ServiceOrderStatus.CANCELLED) {
    // Regularizacao explicita: o pagamento confirmado precisa ser estornado (PAID -> REFUNDED) antes de cancelar.
    const paid = await transaction.payment.count({ where: { organizationId, serviceOrderId: id, status: PaymentStatus.PAID } });
    if (paid > 0) throw new PaidPaymentsError();
  }
}

export class PrismaServiceOrderRepository implements ServiceOrderRepository {
  constructor(private readonly db: PrismaClient) {}

  async referencesBelongToOrganization(organizationId: string, customerId: string, equipmentId: string): Promise<boolean> {
    const [customer, equipment] = await Promise.all([
      this.db.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } }),
      this.db.equipment.findFirst({ where: { id: equipmentId, customerId, organizationId }, select: { id: true } }),
    ]);
    return customer !== null && equipment !== null;
  }

  async create(organizationId: string, changedByUserId: string, input: CreateServiceOrderInput): Promise<ServiceOrderRecord> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.$transaction(async (transaction) => {
          const serviceOrder = await transaction.serviceOrder.create({
            data: {
              ...input,
              organizationId,
              orderNumber: generateOrderNumber(),
              status: ServiceOrderStatus.RECEIVED,
              receivedAt: new Date(),
            },
            include: orderInclude,
          });
          await transaction.serviceOrderStatusHistory.create({
            data: {
              organizationId,
              serviceOrderId: serviceOrder.id,
              fromStatus: null,
              toStatus: ServiceOrderStatus.RECEIVED,
              changedByUserId,
            },
          });
          return serviceOrder;
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || attempt === 2) throw error;
      }
    }
    throw new Error('Unable to generate service order number');
  }

  async list(organizationId: string, query: ListServiceOrdersQuery): Promise<Page<ServiceOrderRecord>> {
    const term = query.q;
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.equipmentId ? { equipmentId: query.equipmentId } : {}),
      ...(term ? { OR: [{ orderNumber: containsInsensitive(term) }, { customer: { name: containsInsensitive(term) } }, { equipment: { type: containsInsensitive(term) } }, { equipment: { brand: containsInsensitive(term) } }, { equipment: { model: containsInsensitive(term) } }] } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.serviceOrder.findMany({ where, include: orderInclude, orderBy: newestFirst, ...skipTake(query) }),
      this.db.serviceOrder.count({ where }),
    ]);
    return { items, total };
  }

  findById(organizationId: string, id: string): Promise<ServiceOrderRecord | null> {
    return this.db.serviceOrder.findFirst({ where: { id, organizationId }, include: orderInclude });
  }

  async update(organizationId: string, id: string, input: UpdateServiceOrderInput, options: { canEditValues?: boolean } = {}): Promise<ServiceOrderRecord | null> {
    // Alterar finalValue muda o valor devido: segue a mesma ordem de locks dos pagamentos e dos itens do orcamento.
    return this.db.$transaction(async (transaction) => {
      if ((await lockEditableServiceOrder(transaction, organizationId, id)) === null) return null;
      const touchesValues = 'finalValue' in input || 'estimatedValue' in input;
      if (touchesValues) {
        // O formulario reenvia os valores atuais ao editar outros campos: so conta como alteracao o que de fato muda.
        const current = await transaction.serviceOrder.findFirstOrThrow({ where: { id, organizationId }, select: { finalValue: true, estimatedValue: true } });
        const differs = (next: string | null | undefined, now: Prisma.Decimal | null) => next !== undefined && (next === null ? now !== null : now === null || !new Prisma.Decimal(next).equals(now));
        const changesValues = differs(input.finalValue, current.finalValue) || differs(input.estimatedValue, current.estimatedValue);
        if (changesValues && !options.canEditValues) throw new FinancialChangeForbiddenError();
      }
      const apply = () => transaction.serviceOrder.updateMany({ where: { id, organizationId }, data: input });
      if ('finalValue' in input) await guardDueValueChange(transaction, organizationId, id, apply); else await apply();
      return transaction.serviceOrder.findFirst({ where: { id, organizationId }, include: orderInclude });
    });
  }

  async updateStatus(organizationId: string, id: string, changedByUserId: string, status: ServiceOrderStatus): Promise<ServiceOrderRecord | null> {
    return this.db.$transaction(async (transaction) => {
      // Estado atual lido SOB o lock: duas mudancas simultaneas se serializam e a segunda ve o resultado da primeira.
      const currentStatus = await lockServiceOrderRow(transaction, organizationId, id);
      if (currentStatus === null) return null;
      if (!SERVICE_ORDER_TRANSITIONS[currentStatus].includes(status)) throw new InvalidStatusTransitionError();
      await assertTransitionPreconditions(transaction, organizationId, id, status);

      await transaction.serviceOrder.update({ where: { id }, data: { status, ...(status === ServiceOrderStatus.DELIVERED ? { completedAt: new Date() } : {}) } });
      await transaction.serviceOrderStatusHistory.create({ data: { organizationId, serviceOrderId: id, fromStatus: currentStatus, toStatus: status, changedByUserId } });
      return transaction.serviceOrder.findFirst({ where: { id, organizationId }, include: orderInclude });
    });
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    try {
      const result = await this.db.serviceOrder.deleteMany({ where: { id, organizationId } });
      return result.count > 0;
    } catch (error) {
      if (isForeignKeyRestriction(error)) throw new ServiceOrderInUseError();
      throw error;
    }
  }
}

export class ServiceOrderInUseError extends Error {
  constructor() {
    super('Service order cannot be deleted while it has related records');
    this.name = 'ServiceOrderInUseError';
  }
}