import { describe, expect, it } from 'vitest';
import type { DashboardResponse } from '../types/dashboard';
import { summarizeDashboard } from './dashboard';

const dashboardData: DashboardResponse = {
  serviceOrders: { total: 14, byStatus: { RECEIVED: 2, WAITING_DIAGNOSIS: 3, WAITING_APPROVAL: 1, APPROVED: 1, IN_PROGRESS: 2, READY: 1, DELIVERED: 3, CANCELLED: 1 } },
  customers: { total: 5 }, equipment: { total: 7 },
  quotes: { byStatus: { PENDING: 2, APPROVED: 3, REJECTED: 1, EXPIRED: 0 }, pendingTotal: '300.00', approvedTotal: '1250.50' },
  payments: { byStatus: { PENDING: 2, PAID: 2, FAILED: 1, CANCELLED: 1, REFUNDED: 1 }, paidTotal: '800.25' },
  warranties: { active: 2, expired: 1, cancelled: 0 },
  recentServiceOrders: [],
};

describe('summarizeDashboard', () => {
  it('counts open orders excluding delivered and cancelled ones', () => {
    const summary = summarizeDashboard(dashboardData);
    expect(summary.totalOrders).toBe(14);
    expect(summary.openOrders).toBe(10);
    expect(summary.waitingDiagnosis).toBe(3);
    expect(summary.waitingApproval).toBe(1);
    expect(summary.readyOrders).toBe(1);
    expect(summary.deliveredOrders).toBe(3);
  });

  it('uses only paid payments and pending/approved quotes', () => {
    const summary = summarizeDashboard(dashboardData);
    expect(summary.paidPayments).toBe(2);
    expect(summary.paidTotal).toBe('800.25');
    expect(summary.pendingQuotes).toBe(2);
    expect(summary.pendingQuotesTotal).toBe('300.00');
    expect(summary.approvedQuotes).toBe(3);
    expect(summary.approvedQuotesTotal).toBe('1250.50');
  });

  it('treats missing status keys as zero', () => {
    const summary = summarizeDashboard({ ...dashboardData, serviceOrders: { total: 0, byStatus: {} }, quotes: { byStatus: {}, pendingTotal: '0.00', approvedTotal: '0.00' }, payments: { byStatus: {}, paidTotal: '0.00' } });
    expect(summary).toMatchObject({ totalOrders: 0, openOrders: 0, deliveredOrders: 0, pendingQuotes: 0, approvedQuotes: 0, paidPayments: 0 });
  });
});
