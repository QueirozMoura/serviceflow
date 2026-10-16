import { api } from './api';
import type { PaymentsOverviewResponse } from '../types/overview';
import type { PageParams } from '../types/pagination';
import { buildQuery } from '../utils/query';
import type { PaymentInput, PaymentResponse, PaymentStatus, PaymentsResponse } from '../types/payment';

export const paymentsService = {
  /** Lista agregada e paginada usada pela tela de Pagamentos; exige permissão de pagamentos. */
  listOverview: ({ page, pageSize, q, status }: PageParams & { status?: PaymentStatus }) => api.get<PaymentsOverviewResponse>(`/api/payments${buildQuery({ page, pageSize, q, status })}`),
  list: (serviceOrderId: string) => api.get<PaymentsResponse>(`/api/service-orders/${serviceOrderId}/payments`),
  get: (serviceOrderId: string, paymentId: string) => api.get<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`),
  /** `idempotencyKey` identifica a operação: repetir a mesma tentativa deve reutilizá-la; uma operação nova exige outra. */
  create: (serviceOrderId: string, input: PaymentInput, idempotencyKey: string) => api.post<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments`, input, { 'Idempotency-Key': idempotencyKey }),
  update: (serviceOrderId: string, paymentId: string, input: Partial<PaymentInput>) => api.patch<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`, input),
  updateStatus: (serviceOrderId: string, paymentId: string, status: PaymentStatus) => api.patch<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}/status`, { status }),
  remove: (serviceOrderId: string, paymentId: string) => api.delete<void>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`),
};