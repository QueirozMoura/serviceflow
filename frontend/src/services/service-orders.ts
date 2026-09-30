import { api } from './api';
import type { DiagnosisResponse, MessageResponse, PaymentsResponse, QuoteResponse, ServiceOrderInput, ServiceOrderResponse, ServiceOrderStatus, ServiceOrderUpdate, ServiceOrdersResponse, WarrantyResponse, MessageType } from '../types/service-order';

export const serviceOrdersService = {
  list: (status?: ServiceOrderStatus) => api.get<ServiceOrdersResponse>(`/api/service-orders${status ? `?status=${status}` : ''}`),
  get: (id: string) => api.get<ServiceOrderResponse>(`/api/service-orders/${id}`),
  create: (input: ServiceOrderInput) => api.post<ServiceOrderResponse>('/api/service-orders', input),
  update: (id: string, input: ServiceOrderUpdate) => api.patch<ServiceOrderResponse>(`/api/service-orders/${id}`, input),
  updateStatus: (id: string, status: ServiceOrderStatus) => api.patch<ServiceOrderResponse>(`/api/service-orders/${id}/status`, { status }),
  remove: (id: string) => api.delete<void>(`/api/service-orders/${id}`),
  getDiagnosis: (id: string) => api.get<DiagnosisResponse>(`/api/service-orders/${id}/diagnosis`),
  createDiagnosis: (id: string, input: { description: string; estimatedCost?: string | null }) => api.post<DiagnosisResponse>(`/api/service-orders/${id}/diagnosis`, input),
  updateDiagnosis: (id: string, input: { description?: string; estimatedCost?: string | null }) => api.patch<DiagnosisResponse>(`/api/service-orders/${id}/diagnosis`, input),
  getQuote: (id: string) => api.get<QuoteResponse>(`/api/service-orders/${id}/quote`),
  getPayments: (id: string) => api.get<PaymentsResponse>(`/api/service-orders/${id}/payments`),
  getWarranty: (id: string) => api.get<WarrantyResponse>(`/api/service-orders/${id}/warranty`),
  generateMessage: (id: string, type: MessageType) => api.post<MessageResponse>(`/api/service-orders/${id}/messages`, { type }),
};
