import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../services/api';
import type { PaymentOverviewRow, QuoteOverviewRow, WarrantyOverviewRow } from '../../types/overview';

const quotesMock = vi.hoisted(() => ({ listOverview: vi.fn(), get: vi.fn() }));
const paymentsMock = vi.hoisted(() => ({ listOverview: vi.fn(), list: vi.fn() }));
const warrantiesMock = vi.hoisted(() => ({ listOverview: vi.fn(), get: vi.fn() }));
const serviceOrdersMock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../services/quotes', () => ({ quotesService: quotesMock }));
vi.mock('../../services/payments', () => ({ paymentsService: paymentsMock }));
vi.mock('../../services/warranties', () => ({ warrantiesService: warrantiesMock }));
vi.mock('../../services/service-orders', () => ({ serviceOrdersService: serviceOrdersMock }));

import { PaymentsPage, QuotesPage, WarrantiesPage } from './ModuleList';

const order = (id: string, number: string, customer: string) => ({ id, orderNumber: number, customer: { name: customer } });
const quoteRows: QuoteOverviewRow[] = [
  { serviceOrder: order('o2', 'OS-2', 'Bruno Lima'), quote: { id: 'q2', status: 'PENDING', total: '50.00', itemsCount: 1, updatedAt: '2026-10-16T10:00:00.000Z' } },
  { serviceOrder: order('o1', 'OS-1', 'Alice Silva'), quote: { id: 'q1', status: 'APPROVED', total: '300.00', itemsCount: 2, updatedAt: '2026-10-15T10:00:00.000Z' } },
];
const paymentRows: PaymentOverviewRow[] = [
  { serviceOrder: order('o2', 'OS-2', 'Bruno Lima'), payments: [{ id: 'p3', amount: '10.00', status: 'FAILED', method: 'CARD', updatedAt: '2026-10-16T10:00:00.000Z' }] },
  { serviceOrder: order('o1', 'OS-1', 'Alice Silva'), payments: [
    { id: 'p2', amount: '100.00', status: 'PENDING', method: 'CASH', updatedAt: '2026-10-15T12:00:00.000Z' },
    { id: 'p1', amount: '200.00', status: 'PAID', method: 'PIX', updatedAt: '2026-10-15T10:00:00.000Z' },
  ] },
];
const warrantyRows: WarrantyOverviewRow[] = [
  { serviceOrder: order('o2', 'OS-2', 'Bruno Lima'), warranty: { id: 'w2', status: 'EXPIRED', startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-06-01T00:00:00.000Z', description: 'Garantia vencida', updatedAt: '2026-10-16T10:00:00.000Z' } },
  { serviceOrder: order('o1', 'OS-1', 'Alice Silva'), warranty: { id: 'w1', status: 'ACTIVE', startDate: '2026-10-01T00:00:00.000Z', endDate: '2999-01-01T00:00:00.000Z', description: 'Garantia vigente', updatedAt: '2026-10-15T10:00:00.000Z' } },
];

const text = (node: HTMLElement | null) => (node?.textContent ?? '').replaceAll(String.fromCharCode(160), ' ');
const metric = (label: string) => screen.getByText(label, { selector: '.financial-metric p' }).closest('.financial-metric') as HTMLElement;
const renderPage = (page: 'quotes' | 'payments' | 'warranties') => render(<MemoryRouter>{page === 'quotes' ? <QuotesPage /> : page === 'payments' ? <PaymentsPage /> : <WarrantiesPage />}</MemoryRouter>);
const expectNoPerOrderCalls = () => {
  expect(serviceOrdersMock.list).not.toHaveBeenCalled();
  expect(quotesMock.get).not.toHaveBeenCalled();
  expect(paymentsMock.list).not.toHaveBeenCalled();
  expect(warrantiesMock.get).not.toHaveBeenCalled();
};

describe('financial module lists (aggregated loading)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quotesMock.listOverview.mockResolvedValue({ quotes: quoteRows });
    paymentsMock.listOverview.mockResolvedValue({ payments: paymentRows });
    warrantiesMock.listOverview.mockResolvedValue({ warranties: warrantyRows });
  });

  describe('quotes', () => {
    it('loads everything with a single request and no per-order calls', async () => {
      renderPage('quotes');
      expect(screen.getByRole('status').textContent).toContain('Carregando orçamentos');
      await screen.findByRole('table');

      expect(quotesMock.listOverview).toHaveBeenCalledTimes(1);
      expectNoPerOrderCalls();
    });

    it('shows the rows, item counts and totals', async () => {
      renderPage('quotes');
      await screen.findByRole('table');

      const rows = screen.getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      expect(text(rows[0]!)).toContain('OS-2');
      expect(text(rows[0]!)).toContain('Bruno Lima');
      expect(text(rows[0]!)).toContain('R$ 50,00');
      expect(text(rows[0]!)).toContain('1 item');
      expect(text(rows[1]!)).toContain('2 itens');
      expect(text(rows[1]!)).toContain('Aprovado');
      expect(within(rows[1]!).getAllByRole('link')[0]!.getAttribute('href')).toBe('/service-orders/o1');
      expect(text(metric('Aguardando aprovação'))).toContain('1');
      expect(text(metric('Valor aprovado'))).toContain('R$ 300,00');
      expect(text(metric('Valor total em orçamentos'))).toContain('R$ 350,00');
    });

    it('filters by status and searches by order or customer without new requests', async () => {
      renderPage('quotes');
      await screen.findByRole('table');

      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'APPROVED' } });
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
      expect(text(screen.getByText('1 registro'))).toBe('1 registro');
      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'ALL' } });
      fireEvent.change(screen.getByLabelText('Buscar orçamentos'), { target: { value: 'bruno' } });
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
      expect(screen.getByText('OS-2', { exact: false })).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Buscar orçamentos'), { target: { value: 'inexistente' } });
      expect(screen.getByText('Nenhum registro encontrado para essa busca.')).toBeTruthy();
      expect(quotesMock.listOverview).toHaveBeenCalledTimes(1);
    });

    it('shows the empty state', async () => {
      quotesMock.listOverview.mockResolvedValue({ quotes: [] });
      renderPage('quotes');
      expect(await screen.findByText('Nenhum orçamento cadastrado.')).toBeTruthy();
      expect(text(metric('Valor total em orçamentos'))).toContain('R$ 0,00');
    });

    it('shows an error and retries with one more request', async () => {
      quotesMock.listOverview.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ quotes: quoteRows });
      renderPage('quotes');
      expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar orçamentos');

      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      await screen.findByRole('table');
      expect(quotesMock.listOverview).toHaveBeenCalledTimes(2);
      expectNoPerOrderCalls();
    });

    it('explains an expired session and a missing permission', async () => {
      quotesMock.listOverview.mockRejectedValueOnce(new ApiError('Authentication required', 401));
      const first = renderPage('quotes');
      expect((await screen.findByRole('alert')).textContent).toContain('Sua sessão expirou');
      first.unmount();

      quotesMock.listOverview.mockRejectedValueOnce(new ApiError('You do not have permission to perform this action', 403));
      renderPage('quotes');
      expect((await screen.findByRole('alert')).textContent).toContain('Você não tem permissão');
    });

    it('keeps showing loading until the single request resolves', async () => {
      let resolve: (value: { quotes: QuoteOverviewRow[] }) => void = () => undefined;
      quotesMock.listOverview.mockReturnValue(new Promise((r) => { resolve = r; }));
      renderPage('quotes');
      expect(screen.getByRole('status')).toBeTruthy();
      await act(async () => { resolve({ quotes: quoteRows }); });
      expect(screen.queryByRole('status')).toBeNull();
      expect(quotesMock.listOverview).toHaveBeenCalledTimes(1);
    });
  });

  describe('payments', () => {
    it('loads everything with a single request and no per-order calls', async () => {
      renderPage('payments');
      await screen.findByRole('table');
      expect(paymentsMock.listOverview).toHaveBeenCalledTimes(1);
      expectNoPerOrderCalls();
    });

    it('counts only paid payments as received and keeps pending ones apart', async () => {
      renderPage('payments');
      await screen.findByRole('table');

      expect(text(metric('Recebido'))).toContain('R$ 200,00');
      expect(text(metric('Pendente'))).toContain('R$ 100,00');
      expect(text(metric('Lançamentos registrados'))).toContain('3');
    });

    it('summarizes orders with several payments and filters by any payment status', async () => {
      renderPage('payments');
      await screen.findByRole('table');

      const rows = screen.getAllByRole('row').slice(1);
      expect(text(rows[0]!)).toContain('Bruno Lima');
      expect(text(rows[1]!)).toContain('R$ 300,00');
      expect(text(rows[1]!)).toContain('2 lançamentos');
      expect(text(rows[1]!)).toContain('2 pagamentos');
      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'PAID' } });
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
      expect(screen.queryByText('Bruno Lima')).toBeNull();
    });

    it('shows the empty state and errors', async () => {
      paymentsMock.listOverview.mockResolvedValueOnce({ payments: [] }).mockRejectedValueOnce(new ApiError('You do not have permission to perform this action', 403));
      const first = renderPage('payments');
      expect(await screen.findByText('Nenhum pagamento registrado.')).toBeTruthy();
      first.unmount();
      renderPage('payments');
      expect((await screen.findByRole('alert')).textContent).toContain('Você não tem permissão');
    });
  });

  describe('warranties', () => {
    it('loads everything with a single request and shows counts', async () => {
      renderPage('warranties');
      await screen.findByRole('table');

      expect(warrantiesMock.listOverview).toHaveBeenCalledTimes(1);
      expectNoPerOrderCalls();
      expect(text(metric('Garantias ativas'))).toContain('1');
      expect(text(metric('Garantias expiradas'))).toContain('1');
      expect(text(metric('Total de garantias'))).toContain('2');
      expect(screen.getByText('Garantia vigente')).toBeTruthy();
    });

    it('filters expired warranties and shows the empty state', async () => {
      const view = renderPage('warranties');
      await screen.findByRole('table');
      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'EXPIRED' } });
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
      expect(screen.getByText('Garantia vencida')).toBeTruthy();
      view.unmount();

      warrantiesMock.listOverview.mockResolvedValue({ warranties: [] });
      renderPage('warranties');
      expect(await screen.findByText('Nenhuma garantia cadastrada.')).toBeTruthy();
    });
  });
});
