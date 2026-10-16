import { api } from './api';
import type { CustomerInput, CustomerOptionsResponse, CustomerResponse, CustomersResponse } from '../types/customer';
import type { PageParams } from '../types/pagination';
import { buildQuery } from '../utils/query';

export const customersService = {
  /** Lista paginada pelo servidor, com busca por nome, telefone, e-mail ou documento. */
  list: ({ page, pageSize, q }: PageParams) => api.get<CustomersResponse>(`/api/customers${buildQuery({ page, pageSize, q })}`),
  /** Todas as opções (id, nome, telefone) para seletores de formulário. */
  options: () => api.get<CustomerOptionsResponse>('/api/customers/options'),
  get: (id: string) => api.get<CustomerResponse>(`/api/customers/${id}`),
  create: (input: CustomerInput) => api.post<CustomerResponse>('/api/customers', input),
  update: (id: string, input: Partial<CustomerInput>) => api.patch<CustomerResponse>(`/api/customers/${id}`, input),
  remove: (id: string) => api.delete<void>(`/api/customers/${id}`),
};
