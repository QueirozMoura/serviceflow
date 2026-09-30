import type { PrismaClient, Customer } from '@prisma/client';
import type { CreateCustomerInput, UpdateCustomerInput } from './schemas.js';

export type CustomerRecord = Pick<
  Customer,
  'id' | 'organizationId' | 'name' | 'email' | 'phone' | 'document' | 'address' | 'notes' | 'createdAt' | 'updatedAt'
>;

export interface CustomerRepository {
  create(organizationId: string, input: CreateCustomerInput): Promise<CustomerRecord>;
  list(organizationId: string): Promise<CustomerRecord[]>;
  findById(organizationId: string, id: string): Promise<CustomerRecord | null>;
  update(organizationId: string, id: string, input: UpdateCustomerInput): Promise<CustomerRecord | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly db: PrismaClient) {}

  create(organizationId: string, input: CreateCustomerInput): Promise<CustomerRecord> {
    return this.db.customer.create({ data: { ...input, organizationId } });
  }

  list(organizationId: string): Promise<CustomerRecord[]> {
    return this.db.customer.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  findById(organizationId: string, id: string): Promise<CustomerRecord | null> {
    return this.db.customer.findFirst({ where: { id, organizationId } });
  }

  async update(organizationId: string, id: string, input: UpdateCustomerInput): Promise<CustomerRecord | null> {
    const result = await this.db.customer.updateMany({ where: { id, organizationId }, data: input });
    if (result.count === 0) return null;

    return this.findById(organizationId, id);
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const result = await this.db.customer.deleteMany({ where: { id, organizationId } });
    return result.count > 0;
  }
}