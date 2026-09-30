import { api } from './api';
import type { CustomerInput, CustomerResponse, CustomersResponse } from '../types/customer';

export const customersService = {
  list: () => api.get<CustomersResponse>('/api/customers'),
  get: (id: string) => api.get<CustomerResponse>(`/api/customers/${id}`),
  create: (input: CustomerInput) => api.post<CustomerResponse>('/api/customers', input),
  update: (id: string, input: Partial<CustomerInput>) => api.patch<CustomerResponse>(`/api/customers/${id}`, input),
  remove: (id: string) => api.delete<void>(`/api/customers/${id}`),
};
