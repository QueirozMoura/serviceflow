import { api } from './api';
import type { QuotesOverviewResponse } from '../types/overview';
import type { PageParams } from '../types/pagination';
import { buildQuery } from '../utils/query';
import type { CreateQuoteInput, QuoteResponse, QuoteStatus, ServiceItemInput, UpdateQuoteInput } from '../types/quote';

export const quotesService = {
  /** Lista agregada e paginada (uma requisição por página) usada pela tela de Orçamentos. */
  listOverview: ({ page, pageSize, q, status }: PageParams & { status?: QuoteStatus }) => api.get<QuotesOverviewResponse>(`/api/quotes${buildQuery({ page, pageSize, q, status })}`),
  create: (serviceOrderId: string, input: CreateQuoteInput = {}) => api.post<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote`, input),
  get: (serviceOrderId: string) => api.get<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote`),
  update: (serviceOrderId: string, input: UpdateQuoteInput) => api.patch<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote`, input),
  updateStatus: (serviceOrderId: string, status: QuoteStatus) => api.patch<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote/status`, { status }),
  remove: (serviceOrderId: string) => api.delete<void>(`/api/service-orders/${serviceOrderId}/quote`),
  addItem: (serviceOrderId: string, input: ServiceItemInput) => api.post<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote/items`, input),
  updateItem: (serviceOrderId: string, itemId: string, input: Partial<ServiceItemInput>) => api.patch<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote/items/${itemId}`, input),
  removeItem: (serviceOrderId: string, itemId: string) => api.delete<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote/items/${itemId}`),
};