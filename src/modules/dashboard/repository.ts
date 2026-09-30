import { PaymentStatus, Prisma, QuoteStatus, ServiceOrderStatus, WarrantyStatus, type PrismaClient } from '@prisma/client';

export type DashboardData = {
  serviceOrders: { total: number; byStatus: Record<ServiceOrderStatus, number> };
  customers: { total: number };
  equipment: { total: number };
  quotes: { byStatus: Record<QuoteStatus, number>; pendingTotal: string; approvedTotal: string };
  payments: { byStatus: Record<PaymentStatus, number>; paidTotal: string };
  warranties: { active: number; expired: number; cancelled: number };
  recentServiceOrders: Array<{
    id: string;
    orderNumber: string;
    status: ServiceOrderStatus;
    problemDescription: string;
    customer: { id: string; name: string };
    equipment: { id: string; type: string; brand: string | null; model: string | null };
    createdAt: Date;
    updatedAt: Date;
  }>;
};

export interface DashboardRepository {
  getDashboard(organizationId: string): Promise<DashboardData>;
}

const serviceOrderStatuses = Object.values(ServiceOrderStatus);
const quoteStatuses = Object.values(QuoteStatus);
const paymentStatuses = Object.values(PaymentStatus);

function emptyCounts<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function money(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2);
}

export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private readonly db: PrismaClient) {}

  getDashboard(organizationId: string): Promise<DashboardData> {
    return this.db.$transaction(async (transaction) => {
      const now = new Date();
      const [
        serviceOrderGroups,
        customerTotal,
        equipmentTotal,
        quoteGroups,
        paymentGroups,
        activeWarranties,
        expiredWarranties,
        cancelledWarranties,
        recentServiceOrders,
      ] = await Promise.all([
        transaction.serviceOrder.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
        transaction.customer.count({ where: { organizationId } }),
        transaction.equipment.count({ where: { organizationId } }),
        transaction.quote.groupBy({ by: ['status'], where: { serviceOrder: { organizationId } }, _count: { _all: true }, _sum: { total: true } }),
        transaction.payment.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true }, _sum: { amount: true } }),
        transaction.warranty.count({ where: { organizationId, status: WarrantyStatus.ACTIVE, endDate: { gt: now } } }),
        transaction.warranty.count({ where: { organizationId, OR: [{ status: WarrantyStatus.EXPIRED }, { status: WarrantyStatus.ACTIVE, endDate: { lte: now } }] } }),
        transaction.warranty.count({ where: { organizationId, status: WarrantyStatus.CANCELLED } }),
        transaction.serviceOrder.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            problemDescription: true,
            createdAt: true,
            updatedAt: true,
            customer: { select: { id: true, name: true } },
            equipment: { select: { id: true, type: true, brand: true, model: true } },
          },
        }),
      ]);

      const serviceOrdersByStatus = emptyCounts(serviceOrderStatuses);
      for (const group of serviceOrderGroups) serviceOrdersByStatus[group.status] = group._count._all;

      const quotesByStatus = emptyCounts(quoteStatuses);
      let pendingTotal = new Prisma.Decimal(0);
      let approvedTotal = new Prisma.Decimal(0);
      for (const group of quoteGroups) {
        quotesByStatus[group.status] = group._count._all;
        if (group.status === QuoteStatus.PENDING) pendingTotal = group._sum.total ?? new Prisma.Decimal(0);
        if (group.status === QuoteStatus.APPROVED) approvedTotal = group._sum.total ?? new Prisma.Decimal(0);
      }

      const paymentsByStatus = emptyCounts(paymentStatuses);
      let paidTotal = new Prisma.Decimal(0);
      for (const group of paymentGroups) {
        paymentsByStatus[group.status] = group._count._all;
        if (group.status === PaymentStatus.PAID) paidTotal = group._sum.amount ?? new Prisma.Decimal(0);
      }

      return {
        serviceOrders: { total: serviceOrderGroups.reduce((total, group) => total + group._count._all, 0), byStatus: serviceOrdersByStatus },
        customers: { total: customerTotal },
        equipment: { total: equipmentTotal },
        quotes: { byStatus: quotesByStatus, pendingTotal: money(pendingTotal), approvedTotal: money(approvedTotal) },
        payments: { byStatus: paymentsByStatus, paidTotal: money(paidTotal) },
        warranties: { active: activeWarranties, expired: expiredWarranties, cancelled: cancelledWarranties },
        recentServiceOrders,
      };
    });
  }
}