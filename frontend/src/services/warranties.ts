import { api } from './api';
import type { WarrantyOverviewRow } from '../types/overview';
import type { WarrantyInput, WarrantyResponse, WarrantyStatus, WarrantyUpdate } from '../types/warranty';

export const warrantiesService = {
  /** Lista agregada (uma requisição) usada pela tela de Garantias. */
  listOverview: () => api.get<{ warranties: WarrantyOverviewRow[] }>('/api/warranties'),
  get: (serviceOrderId: string) => api.get<WarrantyResponse>(`/api/service-orders/${serviceOrderId}/warranty`),
  create: (serviceOrderId: string, input: WarrantyInput) => api.post<WarrantyResponse>(`/api/service-orders/${serviceOrderId}/warranty`, input),
  update: (serviceOrderId: string, input: WarrantyUpdate) => api.patch<WarrantyResponse>(`/api/service-orders/${serviceOrderId}/warranty`, input),
  updateStatus: (serviceOrderId: string, status: WarrantyStatus) => api.patch<WarrantyResponse>(`/api/service-orders/${serviceOrderId}/warranty/status`, { status }),
  remove: (serviceOrderId: string) => api.delete<void>(`/api/service-orders/${serviceOrderId}/warranty`),
};