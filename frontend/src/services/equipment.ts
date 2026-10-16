import { api } from './api';
import type { EquipmentInput, EquipmentListResponse, EquipmentOptionsResponse, EquipmentResponse } from '../types/equipment';
import type { PageParams } from '../types/pagination';
import { buildQuery } from '../utils/query';

export const equipmentService = {
  /** Lista paginada pelo servidor, com busca e filtro por cliente. */
  list: ({ page, pageSize, q, customerId }: PageParams & { customerId?: string }) => api.get<EquipmentListResponse>(`/api/equipment${buildQuery({ page, pageSize, q, customerId })}`),
  /** Equipamentos de um cliente (seletores e telas relacionadas), sem paginação. */
  options: (customerId: string) => api.get<EquipmentOptionsResponse>(`/api/equipment/options${buildQuery({ customerId })}`),
  get: (id: string) => api.get<EquipmentResponse>(`/api/equipment/${id}`),
  create: (input: EquipmentInput) => api.post<EquipmentResponse>('/api/equipment', input),
  update: (id: string, input: Partial<EquipmentInput>) => api.patch<EquipmentResponse>(`/api/equipment/${id}`, input),
  remove: (id: string) => api.delete<void>(`/api/equipment/${id}`),
};
