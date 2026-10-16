import { Prisma, type Equipment, type PrismaClient } from '@prisma/client';
import { containsInsensitive, newestFirst, skipTake, type Page } from '../shared/pagination.js';
import type { CreateEquipmentInput, ListEquipmentQuery, UpdateEquipmentInput } from './schemas.js';

export type EquipmentRecord = Pick<Equipment, 'id' | 'organizationId' | 'customerId' | 'type' | 'brand' | 'model' | 'serialNumber' | 'description' | 'createdAt' | 'updatedAt'> & {
  customer: { id: string; name: string };
};

export type EquipmentOption = Pick<Equipment, 'id' | 'customerId' | 'type' | 'brand' | 'model' | 'serialNumber'>;

export interface EquipmentRepository {
  customerBelongsToOrganization(organizationId: string, customerId: string): Promise<boolean>;
  create(organizationId: string, input: CreateEquipmentInput): Promise<EquipmentRecord>;
  list(organizationId: string, query: ListEquipmentQuery): Promise<Page<EquipmentRecord>>;
  /** Opcoes enxutas dos equipamentos de UM cliente (seletores/relacionados), sem paginacao. */
  listOptions(organizationId: string, customerId: string): Promise<EquipmentOption[]>;
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

  async list(organizationId: string, query: ListEquipmentQuery): Promise<Page<EquipmentRecord>> {
    const term = query.q;
    const where = {
      organizationId,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(term ? { OR: [{ type: containsInsensitive(term) }, { brand: containsInsensitive(term) }, { model: containsInsensitive(term) }, { serialNumber: containsInsensitive(term) }, { customer: { name: containsInsensitive(term) } }] } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.equipment.findMany({ where, include: equipmentInclude, orderBy: newestFirst, ...skipTake(query) }),
      this.db.equipment.count({ where }),
    ]);
    return { items, total };
  }

  listOptions(organizationId: string, customerId: string): Promise<EquipmentOption[]> {
    return this.db.equipment.findMany({ where: { organizationId, customerId }, orderBy: newestFirst, select: { id: true, customerId: true, type: true, brand: true, model: true, serialNumber: true } });
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