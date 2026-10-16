import { api } from './api';
import type { WarrantiesOverviewResponse } from '../types/overview';
import type { PageParams } from '../types/pagination';
import { buildQuery } from '../utils/query';
import type { WarrantyInput, WarrantyResponse, WarrantyStatus, WarrantyUpdate } from '../types/warranty';

export const warrantiesService = {
  /** Lista agregada e paginada usada pela tela de Garantias. */
  listOverview: ({ page, pageSize, q, status }: PageParams & { status?: WarrantyStatus }) => api.get<WarrantiesOverviewResponse>(`/api/warranties${buildQuery({ page, pageSize, q, status })}`),
  get: (serviceOrderId: string) => api.get<WarrantyResponse>(`/api/service-orders/${serviceOrderId}/warranty`),
  create: (serviceOrderId: string, input: WarrantyInput) => api.post<WarrantyResponse>(`/api/service-orders/${serviceOrderId}/warranty`, input),
  update: (serviceOrderId: string, input: WarrantyUpdate) => api.patch<WarrantyResponse>(`/api/service-orders/${serviceOrderId}/warranty`, input),
  updateStatus: (serviceOrderId: string, status: WarrantyStatus) => api.patch<WarrantyResponse>(`/api/service-orders/${serviceOrderId}/warranty/status`, { status }),
  remove: (serviceOrderId: string) => api.delete<void>(`/api/service-orders/${serviceOrderId}/warranty`),
};