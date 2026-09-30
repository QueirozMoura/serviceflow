export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  email?: string | null;
  phone: string;
  document?: string | null;
  address?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CustomerInput = Omit<Pick<Customer, 'name' | 'email' | 'phone' | 'document' | 'address' | 'notes'>, never>;
export interface CustomersResponse { customers: Customer[]; }
export interface CustomerResponse { customer: Customer; }
