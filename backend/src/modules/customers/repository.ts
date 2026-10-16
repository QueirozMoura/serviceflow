import type { PrismaClient, Customer } from '@prisma/client';
import { isForeignKeyRestriction } from '../service-orders/repository.js';
import { containsInsensitive, newestFirst, skipTake, type Page } from '../shared/pagination.js';
import type { CreateCustomerInput, ListCustomersQuery, UpdateCustomerInput } from './schemas.js';

export type CustomerRecord = Pick<
  Customer,
  'id' | 'organizationId' | 'name' | 'email' | 'phone' | 'document' | 'address' | 'notes' | 'createdAt' | 'updatedAt'
>;

export type CustomerOption = Pick<Customer, 'id' | 'name' | 'phone'>;

export interface CustomerRepository {
  create(organizationId: string, input: CreateCustomerInput): Promise<CustomerRecord>;
  list(organizationId: string, query: ListCustomersQuery): Promise<Page<CustomerRecord>>;
  /** Opcoes completas e enxutas para seletores de formularios (sem paginacao, so id/nome/telefone). */
  listOptions(organizationId: string): Promise<CustomerOption[]>;
  findById(organizationId: string, id: string): Promise<CustomerRecord | null>;
  update(organizationId: string, id: string, input: UpdateCustomerInput): Promise<CustomerRecord | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly db: PrismaClient) {}

  create(organizationId: string, input: CreateCustomerInput): Promise<CustomerRecord> {
    return this.db.customer.create({ data: { ...input, organizationId } });
  }

  async list(organizationId: string, query: ListCustomersQuery): Promise<Page<CustomerRecord>> {
    const term = query.q;
    const where = {
      organizationId,
      ...(term ? { OR: [{ name: containsInsensitive(term) }, { phone: containsInsensitive(term) }, { email: containsInsensitive(term) }, { document: containsInsensitive(term) }] } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.customer.findMany({ where, orderBy: newestFirst, ...skipTake(query) }),
      this.db.customer.count({ where }),
    ]);
    return { items, total };
  }

  listOptions(organizationId: string): Promise<CustomerOption[]> {
    return this.db.customer.findMany({ where: { organizationId }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, phone: true } });
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
    try {
      const result = await this.db.customer.deleteMany({ where: { id, organizationId } });
      return result.count > 0;
    } catch (error) {
      if (isForeignKeyRestriction(error)) throw new CustomerInUseError();
      throw error;
    }
  }
}

export class CustomerInUseError extends Error {
  constructor() {
    super('Customer cannot be deleted while it has equipment or service orders');
    this.name = 'CustomerInUseError';
  }
}
