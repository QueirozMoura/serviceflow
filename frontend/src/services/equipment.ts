import { api } from './api';
import type { EquipmentInput, EquipmentListResponse, EquipmentResponse } from '../types/equipment';

export const equipmentService = {
  list: (customerId?: string) => api.get<EquipmentListResponse>(`/api/equipment${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''}`),
  get: (id: string) => api.get<EquipmentResponse>(`/api/equipment/${id}`),
  create: (input: EquipmentInput) => api.post<EquipmentResponse>('/api/equipment', input),
  update: (id: string, input: Partial<EquipmentInput>) => api.patch<EquipmentResponse>(`/api/equipment/${id}`, input),
  remove: (id: string) => api.delete<void>(`/api/equipment/${id}`),
};
