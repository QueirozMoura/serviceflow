import { Prisma, type Equipment, type PrismaClient } from '@prisma/client';
import type { CreateEquipmentInput, UpdateEquipmentInput } from './schemas.js';

export type EquipmentRecord = Pick<Equipment, 'id' | 'organizationId' | 'customerId' | 'type' | 'brand' | 'model' | 'serialNumber' | 'description' | 'createdAt' | 'updatedAt'> & {
  customer: { id: string; name: string };
};

export interface EquipmentRepository {
  customerBelongsToOrganization(organizationId: string, customerId: string): Promise<boolean>;
  create(organizationId: string, input: CreateEquipmentInput): Promise<EquipmentRecord>;
  list(organizationId: string, customerId?: string): Promise<EquipmentRecord[]>;
  findById(organizationId: string, id: string): Promise<EquipmentRecord | null>;
  update(organizationId: string, id: string, input: UpdateEquipmentInput): Promise<EquipmentRecord | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

const equipmentInclude = { customer: { select: { id: true, name: true } } } as const;

export class PrismaEquipmentRepository implements EquipmentRepository {
  constructor(private readonly db: PrismaClient) {}

  async customerBelongsToOrganization(organizationId: string, customerId: string): Promise<boolean> {
    const customer = await this.db.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } });
    return customer !== null;
  }

  create(organizationId: string, input: CreateEquipmentInput): Promise<EquipmentRecord> {
    return this.db.equipment.create({ data: { ...input, organizationId }, include: equipmentInclude });
  }

  list(organizationId: string, customerId?: string): Promise<EquipmentRecord[]> {
    return this.db.equipment.findMany({
      where: { organizationId, ...(customerId ? { customerId } : {}) },
      include: equipmentInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(organizationId: string, id: string): Promise<EquipmentRecord | null> {
    return this.db.equipment.findFirst({ where: { id, organizationId }, include: equipmentInclude });
  }

  async update(organizationId: string, id: string, input: UpdateEquipmentInput): Promise<EquipmentRecord | null> {
    const result = await this.db.equipment.updateMany({ where: { id, organizationId }, data: input });
    if (result.count === 0) return null;

    return this.findById(organizationId, id);
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    try {
      const result = await this.db.equipment.deleteMany({ where: { id, organizationId } });
      return result.count > 0;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new EquipmentInUseError();
      }
      throw error;
    }
  }
}

export class EquipmentInUseError extends Error {
  constructor() {
    super('Equipment cannot be deleted while it is referenced by a service order');
    this.name = 'EquipmentInUseError';
  }
}