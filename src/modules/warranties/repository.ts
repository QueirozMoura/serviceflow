import { Prisma, ServiceOrderStatus, WarrantyStatus, type PrismaClient, type Warranty } from '@prisma/client';
import type { CreateWarrantyInput, UpdateWarrantyInput } from './schemas.js';

export type WarrantyRecord = Pick<Warranty, 'id' | 'organizationId' | 'serviceOrderId' | 'startDate' | 'endDate' | 'description' | 'status' | 'createdAt' | 'updatedAt'> & {
  serviceOrder: { id: string; orderNumber: string; status: ServiceOrderStatus };
};

export interface WarrantyRepository {
  serviceOrderStatus(organizationId: string, serviceOrderId: string): Promise<ServiceOrderStatus | null>;
  findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<WarrantyRecord | null>;
  create(organizationId: string, serviceOrderId: string, input: CreateWarrantyInput): Promise<WarrantyRecord>;
  update(organizationId: string, serviceOrderId: string, input: UpdateWarrantyInput): Promise<WarrantyRecord | null>;
  updateStatus(organizationId: string, serviceOrderId: string, status: WarrantyStatus): Promise<WarrantyRecord | null>;
  delete(organizationId: string, serviceOrderId: string): Promise<boolean>;
}

const warrantyInclude = {
  serviceOrder: { select: { id: true, orderNumber: true, status: true } },
} as const;

export function effectiveWarrantyStatus(warranty: Pick<WarrantyRecord, 'status' | 'endDate'>, now = new Date()): WarrantyStatus {
  return warranty.status === WarrantyStatus.ACTIVE && warranty.endDate <= now ? WarrantyStatus.EXPIRED : warranty.status;
}

function present(record: WarrantyRecord): WarrantyRecord {
  return { ...record, status: effectiveWarrantyStatus(record) };
}

export class PrismaWarrantyRepository implements WarrantyRepository {
  constructor(private readonly db: PrismaClient) {}

  async serviceOrderStatus(organizationId: string, serviceOrderId: string): Promise<ServiceOrderStatus | null> {
    const serviceOrder = await this.db.serviceOrder.findFirst({ where: { id: serviceOrderId, organizationId }, select: { status: true } });
    return serviceOrder?.status ?? null;
  }

  async findByServiceOrder(organizationId: string, serviceOrderId: string): Promise<WarrantyRecord | null> {
    const warranty = await this.db.warranty.findFirst({ where: { serviceOrder: { id: serviceOrderId, organizationId } }, include: warrantyInclude });
    return warranty ? present(warranty) : null;
  }

  async create(organizationId: string, serviceOrderId: string, input: CreateWarrantyInput): Promise<WarrantyRecord> {
    try {
      const warranty = await this.db.warranty.create({ data: { organizationId, serviceOrderId, ...input, status: WarrantyStatus.ACTIVE }, include: warrantyInclude });
      return present(warranty);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new WarrantyAlreadyExistsError();
      throw error;
    }
  }

  async update(organizationId: string, serviceOrderId: string, input: UpdateWarrantyInput): Promise<WarrantyRecord | null> {
    const warranty = await this.findByServiceOrder(organizationId, serviceOrderId);
    if (!warranty) return null;
    if (effectiveWarrantyStatus(warranty) !== WarrantyStatus.ACTIVE) throw new WarrantyImmutableError();
    const updated = await this.db.warranty.update({ where: { id: warranty.id }, data: input, include: warrantyInclude });
    return present(updated);
  }

  async updateStatus(organizationId: string, serviceOrderId: string, status: WarrantyStatus): Promise<WarrantyRecord | null> {
    const warranty = await this.findByServiceOrder(organizationId, serviceOrderId);
    if (!warranty) return null;
    const updated = await this.db.warranty.update({ where: { id: warranty.id }, data: { status }, include: warrantyInclude });
    return present(updated);
  }

  async delete(organizationId: string, serviceOrderId: string): Promise<boolean> {
    const warranty = await this.findByServiceOrder(organizationId, serviceOrderId);
    if (!warranty) return false;
    if (effectiveWarrantyStatus(warranty) !== WarrantyStatus.ACTIVE) throw new WarrantyImmutableError();
    try {
      await this.db.warranty.delete({ where: { id: warranty.id } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new WarrantyInUseError();
      throw error;
    }
  }
}

export class WarrantyAlreadyExistsError extends Error {}
export class WarrantyImmutableError extends Error {}
export class WarrantyInUseError extends Error {}