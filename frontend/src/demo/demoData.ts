import type { DashboardResponse } from '../types/dashboard';

export const demoDashboardData: DashboardResponse = {
  serviceOrders: {
    total: 24,
    byStatus: { RECEIVED: 4, WAITING_DIAGNOSIS: 5, IN_PROGRESS: 8, READY: 3, DELIVERED: 4 },
  },
  customers: { total: 186 },
  equipment: { total: 249 },
  quotes: {
    byStatus: { PENDING: 7, APPROVED: 5 },
    pendingTotal: '12840.00',
    approvedTotal: '9670.00',
  },
  payments: {
    byStatus: { PAID: 18, PENDING: 6 },
    paidTotal: '28450.00',
  },
  warranties: { active: 31, expired: 8, cancelled: 2 },
  recentServiceOrders: [
    {
      id: 'demo-order-001',
      orderNumber: 'OS-1048',
      status: 'IN_PROGRESS',
      problemDescription: 'Revisao preventiva',
      customer: { id: 'demo-customer-001', name: 'Marina Alves' },
      equipment: { id: 'demo-equipment-001', type: 'Notebook', brand: 'Dell', model: 'Inspiron 15' },
      createdAt: '2026-10-14T09:30:00.000Z',
      updatedAt: '2026-10-14T14:10:00.000Z',
    },
    {
      id: 'demo-order-002',
      orderNumber: 'OS-1047',
      status: 'WAITING_APPROVAL',
      problemDescription: 'Troca de componente',
      customer: { id: 'demo-customer-002', name: 'Oficina Horizonte' },
      equipment: { id: 'demo-equipment-002', type: 'Impressora', brand: 'Epson', model: 'L3250' },
      createdAt: '2026-10-13T11:15:00.000Z',
      updatedAt: '2026-10-14T10:40:00.000Z',
    },
    {
      id: 'demo-order-003',
      orderNumber: 'OS-1046',
      status: 'READY',
      problemDescription: 'Limpeza e ajustes',
      customer: { id: 'demo-customer-003', name: 'Carlos Mendes' },
      equipment: { id: 'demo-equipment-003', type: 'Celular', brand: 'Samsung', model: 'Galaxy A54' },
      createdAt: '2026-10-12T15:45:00.000Z',
      updatedAt: '2026-10-13T16:20:00.000Z',
    },
  ],
};