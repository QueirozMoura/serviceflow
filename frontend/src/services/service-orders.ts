import { api } from './api';
import type { PageParams } from '../types/pagination';
import { buildQuery } from '../utils/query';
import type { DiagnosisResponse, MessageChannel, MessageHistoryResponse, MessageResponse, RecordedMessageResponse, ServiceOrderInput, ServiceOrderResponse, ServiceOrderStatus, ServiceOrderUpdate, ServiceOrdersResponse, MessageType } from '../types/service-order';

export const serviceOrdersService = {
  /** Lista paginada pelo servidor, com busca (nº da OS, cliente, equipamento) e filtro por status. */
  list: ({ page, pageSize, q, status }: PageParams & { status?: ServiceOrderStatus }) => api.get<ServiceOrdersResponse>(`/api/service-orders${buildQuery({ page, pageSize, q, status })}`),
  get: (id: string) => api.get<ServiceOrderResponse>(`/api/service-orders/${id}`),
  create: (input: ServiceOrderInput) => api.post<ServiceOrderResponse>('/api/service-orders', input),
  update: (id: string, input: ServiceOrderUpdate) => api.patch<ServiceOrderResponse>(`/api/service-orders/${id}`, input),
  updateStatus: (id: string, status: ServiceOrderStatus) => api.patch<ServiceOrderResponse>(`/api/service-orders/${id}/status`, { status }),
  remove: (id: string) => api.delete<void>(`/api/service-orders/${id}`),
  getDiagnosis: (id: string) => api.get<DiagnosisResponse>(`/api/service-orders/${id}/diagnosis`),
  createDiagnosis: (id: string, input: { description: string; estimatedCost?: string | null }) => api.post<DiagnosisResponse>(`/api/service-orders/${id}/diagnosis`, input),
  updateDiagnosis: (id: string, input: { description?: string; estimatedCost?: string | null }) => api.patch<DiagnosisResponse>(`/api/service-orders/${id}/diagnosis`, input),
  removeDiagnosis: (id: string) => api.delete<void>(`/api/service-orders/${id}/diagnosis`),
  getMessageHistory: (id: string) => api.get<MessageHistoryResponse>(`/api/service-orders/${id}/messages/history`),
  /** Registra um rascunho (o texto é gerado no servidor). A chave evita duplicar o registro se a requisição se repetir. */
  recordMessage: (id: string, input: { type: MessageType; channel: MessageChannel }, idempotencyKey: string) => api.post<RecordedMessageResponse>(`/api/service-orders/${id}/messages/history`, input, { 'Idempotency-Key': idempotencyKey }),
  generateMessage: (id: string, type: MessageType) => api.post<MessageResponse>(`/api/service-orders/${id}/messages`, { type }),
};
