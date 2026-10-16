import type { DashboardCountMap, DashboardResponse } from '../types/dashboard';

// Estados reais de ServiceOrderStatus (backend/prisma/schema.prisma); DELIVERED e CANCELLED encerram a OS.
const OPEN_STATUSES = ['RECEIVED', 'WAITING_DIAGNOSIS', 'WAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'READY'] as const;

const count = (map: DashboardCountMap | undefined, key: string) => map?.[key] ?? 0;

export interface DashboardSummary {
  totalOrders: number;
  openOrders: number;
  waitingDiagnosis: number;
  waitingApproval: number;
  readyOrders: number;
  deliveredOrders: number;
  pendingQuotes: number;
  pendingQuotesTotal: string;
  approvedQuotes: number;
  approvedQuotesTotal: string;
  paidPayments: number | null;
  paidTotal: string | null;
}

export function summarizeDashboard(data: DashboardResponse): DashboardSummary {
  const byStatus = data.serviceOrders.byStatus;
  return {
    totalOrders: data.serviceOrders.total,
    openOrders: OPEN_STATUSES.reduce((total, status) => total + count(byStatus, status), 0),
    waitingDiagnosis: count(byStatus, 'WAITING_DIAGNOSIS'),
    waitingApproval: count(byStatus, 'WAITING_APPROVAL'),
    readyOrders: count(byStatus, 'READY'),
    deliveredOrders: count(byStatus, 'DELIVERED'),
    pendingQuotes: count(data.quotes.byStatus, 'PENDING'),
    pendingQuotesTotal: data.quotes.pendingTotal,
    approvedQuotes: count(data.quotes.byStatus, 'APPROVED'),
    approvedQuotesTotal: data.quotes.approvedTotal,
    // paidTotal é calculado pelo backend somente com pagamentos PAID (sem pendentes, falhos, cancelados ou estornados).
    paidPayments: data.payments ? count(data.payments.byStatus, 'PAID') : null,
    paidTotal: data.payments?.paidTotal ?? null,
  };
}
