import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DashboardResponse } from '../../types/dashboard';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/api', () => ({ api: apiMock }));

import { Dashboard } from './Dashboard';

const data: DashboardResponse = {
  serviceOrders: { total: 14, byStatus: { RECEIVED: 2, WAITING_DIAGNOSIS: 3, WAITING_APPROVAL: 1, APPROVED: 1, IN_PROGRESS: 2, READY: 1, DELIVERED: 3, CANCELLED: 1 } },
  customers: { total: 5 }, equipment: { total: 7 },
  quotes: { byStatus: { PENDING: 2, APPROVED: 1, REJECTED: 1, EXPIRED: 0 }, pendingTotal: '300.00', approvedTotal: '1250.50' },
  payments: { byStatus: { PENDING: 2, PAID: 2, FAILED: 1, CANCELLED: 1, REFUNDED: 1 }, paidTotal: '800.25' },
  warranties: { active: 2, expired: 1, cancelled: 0 },
  recentServiceOrders: [{ id: 'order-1', orderNumber: 'OS-1', status: 'WAITING_APPROVAL', problemDescription: 'Tela', customer: { id: 'c1', name: 'Alice Silva' }, equipment: { id: 'e1', type: 'Notebook', brand: 'Dell', model: 'Inspiron' }, createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z' }],
};

const card = (label: string) => screen.getByText(label, { selector: '.metric-card p' }).closest('.metric-card') as HTMLElement;
const renderPage = () => render(<MemoryRouter><Dashboard /></MemoryRouter>);
// Intl separa "R$" do valor com NBSP; normalizamos para comparar texto.
const normalize = (text: string | null) => (text ?? '').replace(/\u00a0/g, ' ');

describe('Dashboard', () => {
  beforeEach(() => { vi.clearAllMocks(); apiMock.get.mockResolvedValue(data); });

  it('shows loading and then the indicators computed from the API data', async () => {
    renderPage();
    expect(screen.getByRole('status').textContent).toContain('Carregando');
    await screen.findByText('Total de ordens');

    expect(apiMock.get).toHaveBeenCalledTimes(1);
    expect(apiMock.get).toHaveBeenCalledWith('/api/dashboard');
    expect(within(card('Total de ordens')).getByText('14')).toBeTruthy();
    expect(within(card('Ordens abertas')).getByText('10')).toBeTruthy();
    expect(within(card('Aguardando diagnóstico')).getByText('3')).toBeTruthy();
    expect(within(card('Aguardando aprovação')).getByText('1')).toBeTruthy();
    expect(within(card('Ordens entregues')).getByText('3')).toBeTruthy();
    expect(within(card('Orçamentos aguardando')).getByText('2')).toBeTruthy();
    expect(normalize(card('Orçamentos aguardando').textContent)).toContain('R$ 300,00 em aberto');
    expect(normalize(card('Orçamentos aprovados').textContent)).toContain('R$ 1.250,50');
    expect(card('Orçamentos aprovados').textContent).toContain('1 orçamento');
  });

  it('shows the total received from paid payments only, not pending, failed, cancelled or refunded ones', async () => {
    renderPage();
    await screen.findByText('Total recebido');
    expect(normalize(card('Total recebido').textContent)).toContain('R$ 800,25');
    expect(card('Total recebido').textContent).toContain('2 pagamentos pagos');
  });

  it('lists recent orders with customer, status, date and a link to the details', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'OS-1' });
    expect(link.getAttribute('href')).toBe('/service-orders/order-1');
    const row = link.closest('tr') as HTMLElement;
    expect(row.textContent).toContain('Alice Silva');
    expect(row.textContent).toContain('Dell Inspiron');
    expect(row.textContent).toContain('Aguardando aprovação');
    expect(row.textContent).toMatch(/15/);
  });

  it('shows zeros and the empty state when the organization has no data', async () => {
    apiMock.get.mockResolvedValue({ ...data, serviceOrders: { total: 0, byStatus: {} }, quotes: { byStatus: {}, pendingTotal: '0.00', approvedTotal: '0.00' }, payments: { byStatus: {}, paidTotal: '0.00' }, recentServiceOrders: [] });
    renderPage();
    expect(await screen.findByText('Nenhuma ordem de serviço registrada ainda.')).toBeTruthy();
    expect(within(card('Total de ordens')).getByText('0')).toBeTruthy();
    expect(normalize(card('Total recebido').textContent)).toContain('R$ 0,00');
    expect(card('Orçamentos aprovados').textContent).toContain('0 orçamentos');
  });

  it('shows "Não informado" when a monetary value is missing', async () => {
    apiMock.get.mockResolvedValue({ ...data, payments: { byStatus: { PAID: 0 }, paidTotal: undefined } });
    renderPage();
    await screen.findByText('Total recebido');
    expect(card('Total recebido').textContent).toContain('Não informado');
  });

  it('shows an error and reloads on retry', async () => {
    apiMock.get.mockRejectedValueOnce(new Error('network')).mockResolvedValue(data);
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar os dados do dashboard');

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Total de ordens');
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  });
});
