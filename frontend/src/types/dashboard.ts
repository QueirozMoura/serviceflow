export type DashboardCountMap = Record<string, number>;

export interface DashboardResponse {
  serviceOrders: {
    total: number;
    byStatus: DashboardCountMap;
  };
  customers: { total: number };
  equipment: { total: number };
  quotes: {
    byStatus: DashboardCountMap;
    pendingTotal: string;
    approvedTotal: string;
  };
  /** null quando o papel do usuário não pode ler pagamentos (o backend omite a receita). */
  payments: {
    byStatus: DashboardCountMap;
    paidTotal: string;
  } | null;
  warranties: {
    active: number;
    expired: number;
    cancelled: number;
  };
  recentServiceOrders: RecentServiceOrder[];
}

export interface RecentServiceOrder {
  id: string;
  orderNumber: string;
  status: string;
  problemDescription: string;
  customer: { id: string; name: string };
  equipment: {
    id: string;
    type: string;
    brand: string | null;
    model: string | null;
  };
  createdAt: string;
  updatedAt: string;
}
