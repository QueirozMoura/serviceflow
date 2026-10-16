import { Prisma, ServiceOrderStatus, type PrismaClient, type ServiceOrder } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { containsInsensitive, newestFirst, skipTake, type Page } from '../shared/pagination.js';
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
  update(organizationId: string, id: string, input: UpdateServiceOrderInput): Promise<ServiceOrderRecord | null>;
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

  async update(organizationId: string, id: string, input: UpdateServiceOrderInput): Promise<ServiceOrderRecord | null> {
    const result = await this.db.serviceOrder.updateMany({ where: { id, organizationId }, data: input });
    if (result.count === 0) return null;
    return this.findById(organizationId, id);
  }

  async updateStatus(organizationId: string, id: string, changedByUserId: string, status: ServiceOrderStatus): Promise<ServiceOrderRecord | null> {
    return this.db.$transaction(async (transaction) => {
      const current = await transaction.serviceOrder.findFirst({ where: { id, organizationId } });
      if (!current) return null;
      await transaction.serviceOrder.update({ where: { id }, data: { status, completedAt: status === ServiceOrderStatus.DELIVERED ? new Date() : current.completedAt } });
      await transaction.serviceOrderStatusHistory.create({ data: { organizationId, serviceOrderId: id, fromStatus: current.status, toStatus: status, changedByUserId } });
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