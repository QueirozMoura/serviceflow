import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { pageInfo, pageOf } from '../../test/paging';
import type { PaymentOverviewRow, PaymentSummary, QuoteOverviewRow, QuoteSummary, WarrantyOverviewRow, WarrantySummary } from '../../types/overview';

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
// Totais que o servidor calcula sobre toda a organizacao (nao dependem de busca, filtro nem pagina).
const quoteSummary: QuoteSummary = { pendingCount: 1, approvedTotal: '300.00', totalValue: '350.00' };
const paymentSummary: PaymentSummary = { paidTotal: '200.00', pendingTotal: '100.00', count: 3 };
const warrantySummary: WarrantySummary = { active: 1, expired: 1, total: 2 };

const text = (node: HTMLElement | null) => (node?.textContent ?? '').replaceAll(String.fromCharCode(160), ' ');
const metric = (label: string) => screen.getByText(label, { selector: '.financial-metric p' }).closest('.financial-metric') as HTMLElement;
const renderPage = (page: 'quotes' | 'payments' | 'warranties') => render(<MemoryRouter>{page === 'quotes' ? <QuotesPage /> : page === 'payments' ? <PaymentsPage /> : <WarrantiesPage />}</MemoryRouter>);
const expectNoPerOrderCalls = () => {
  expect(serviceOrdersMock.list).not.toHaveBeenCalled();
  expect(quotesMock.get).not.toHaveBeenCalled();
  expect(paymentsMock.list).not.toHaveBeenCalled();
  expect(warrantiesMock.get).not.toHaveBeenCalled();
};
const rows = () => screen.getAllByRole('row').slice(1);
const lastCall = (mock: { mock: { calls: unknown[][] } }) => mock.mock.calls.at(-1)?.[0];

describe('financial module lists (server-side pagination)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quotesMock.listOverview.mockResolvedValue({ quotes: quoteRows, pagination: pageInfo(1, 2), summary: quoteSummary });
    paymentsMock.listOverview.mockResolvedValue({ payments: paymentRows, pagination: pageInfo(1, 2), summary: paymentSummary });
    warrantiesMock.listOverview.mockResolvedValue({ warranties: warrantyRows, pagination: pageInfo(1, 2), summary: warrantySummary });
  });

  describe('quotes', () => {
    it('loads one page with a single request and no per-order calls', async () => {
      renderPage('quotes');
      expect(screen.getByRole('status').textContent).toContain('Carregando orçamentos');
      await screen.findByRole('table');

      expect(quotesMock.listOverview).toHaveBeenCalledTimes(1);
      expect(lastCall(quotesMock.listOverview)).toEqual({ page: 1, pageSize: 20, q: '', status: undefined });
      expectNoPerOrderCalls();
    });

    it('shows the rows, item counts and the totals computed by the server', async () => {
      renderPage('quotes');
      await screen.findByRole('table');

      expect(rows()).toHaveLength(2);
      expect(text(rows()[0]!)).toContain('OS-2');
      expect(text(rows()[0]!)).toContain('Bruno Lima');
      expect(text(rows()[0]!)).toContain('R$ 50,00');
      expect(text(rows()[0]!)).toContain('1 item');
      expect(text(rows()[1]!)).toContain('2 itens');
      expect(text(rows()[1]!)).toContain('Aprovado');
      expect(within(rows()[1]!).getAllByRole('link')[0]!.getAttribute('href')).toBe('/service-orders/o1');
      expect(text(metric('Aguardando aprovação'))).toContain('1');
      expect(text(metric('Valor aprovado'))).toContain('R$ 300,00');
      expect(text(metric('Valor total em orçamentos'))).toContain('R$ 350,00');
    });

    it('sends the status filter and the search to the server from the first page, keeping the totals of the whole organization', async () => {
      const all = Array.from({ length: 45 }, (_, index) => ({ ...quoteRows[1]!, serviceOrder: order(`o${index}`, `OS-${String(index + 1).padStart(3, '0')}`, 'Alice Silva'), quote: { ...quoteRows[1]!.quote, id: `q${index}` } }));
      quotesMock.listOverview.mockImplementation(async (params: { page: number; pageSize: number }) => { const { items, pagination } = pageOf(all, params); return { quotes: items, pagination, summary: quoteSummary }; });
      renderPage('quotes');
      await screen.findByRole('table');
      expect(screen.getByText('Mostrando 1–20 de 45 registros')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      await screen.findByText(/OS-021/);
      expect(lastCall(quotesMock.listOverview)).toEqual({ page: 2, pageSize: 20, q: '', status: undefined });

      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'APPROVED' } });
      await waitFor(() => expect(lastCall(quotesMock.listOverview)).toEqual({ page: 1, pageSize: 20, q: '', status: 'APPROVED' }));
      fireEvent.change(screen.getByLabelText('Buscar orçamentos'), { target: { value: 'bruno' } });
      await waitFor(() => expect(lastCall(quotesMock.listOverview)).toEqual({ page: 1, pageSize: 20, q: 'bruno', status: 'APPROVED' }), { timeout: 2000 });
      await screen.findByRole('table');
      expect(text(metric('Valor aprovado'))).toContain('R$ 300,00');
    });

    it('clears the status and the search together', async () => {
      renderPage('quotes');
      await screen.findByRole('table');
      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'PENDING' } });
      await waitFor(() => expect(lastCall(quotesMock.listOverview)).toMatchObject({ status: 'PENDING' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Limpar filtros' }));
      await waitFor(() => expect(lastCall(quotesMock.listOverview)).toEqual({ page: 1, pageSize: 20, q: '', status: undefined }));
      expect((screen.getByLabelText('Filtrar por status') as HTMLSelectElement).value).toBe('ALL');
    });

    it('explains that the totals ignore the search and filters, only while a filter is active', async () => {
      renderPage('quotes');
      await screen.findByRole('table');
      expect(screen.queryByRole('note')).toBeNull();

      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'APPROVED' } });
      expect((await screen.findByRole('note')).textContent).toContain('Os totais acima consideram todos os registros, sem a busca e os filtros aplicados.');

      fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
      await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
    });

    it('shows the empty state when there are no quotes at all, with zeroed totals', async () => {
      quotesMock.listOverview.mockResolvedValue({ quotes: [], pagination: pageInfo(1, 0), summary: { pendingCount: 0, approvedTotal: '0.00', totalValue: '0.00' } });
      renderPage('quotes');
      expect(await screen.findByText('Nenhum orçamento cadastrado.')).toBeTruthy();
      expect(text(metric('Valor total em orçamentos'))).toContain('R$ 0,00');
      expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();
    });

    it('shows a no-results message when the filters match nothing, without the empty-state call to action', async () => {
      renderPage('quotes');
      await screen.findByRole('table');
      quotesMock.listOverview.mockResolvedValue({ quotes: [], pagination: pageInfo(1, 0), summary: quoteSummary });
      fireEvent.change(screen.getByLabelText('Buscar orçamentos'), { target: { value: 'zzz' } });

      expect(await screen.findByText('Nenhum registro encontrado para essa busca.', {}, { timeout: 2000 })).toBeTruthy();
      expect(screen.queryByText('Nenhum orçamento cadastrado.')).toBeNull();
      expect(text(metric('Valor aprovado'))).toContain('R$ 300,00');
    });

    it('shows an error and retries with one more request', async () => {
      quotesMock.listOverview.mockRejectedValueOnce(new Error('network'));
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
      let resolve: (value: unknown) => void = () => undefined;
      quotesMock.listOverview.mockReturnValue(new Promise((r) => { resolve = r; }));
      renderPage('quotes');
      expect(screen.getByRole('status')).toBeTruthy();
      expect(text(metric('Valor aprovado'))).toContain('—');
      await act(async () => { resolve({ quotes: quoteRows, pagination: pageInfo(1, 2), summary: quoteSummary }); });
      expect(screen.queryByRole('status')).toBeNull();
      expect(quotesMock.listOverview).toHaveBeenCalledTimes(1);
    });
  });

  describe('payments', () => {
    it('loads one page with a single request and no per-order calls', async () => {
      renderPage('payments');
      await screen.findByRole('table');
      expect(paymentsMock.listOverview).toHaveBeenCalledTimes(1);
      expect(lastCall(paymentsMock.listOverview)).toEqual({ page: 1, pageSize: 20, q: '', status: undefined });
      expectNoPerOrderCalls();
    });

    it('shows the received total computed by the server from paid payments only, apart from pending ones', async () => {
      renderPage('payments');
      await screen.findByRole('table');

      expect(text(metric('Recebido'))).toContain('R$ 200,00');
      expect(text(metric('Pendente'))).toContain('R$ 100,00');
      expect(text(metric('Lançamentos registrados'))).toContain('3');
    });

    it('summarizes orders with several payments and sends the payment status filter to the server', async () => {
      renderPage('payments');
      await screen.findByRole('table');

      expect(text(rows()[0]!)).toContain('Bruno Lima');
      expect(text(rows()[1]!)).toContain('R$ 300,00');
      expect(text(rows()[1]!)).toContain('2 lançamentos');
      expect(text(rows()[1]!)).toContain('2 pagamentos');
      paymentsMock.listOverview.mockResolvedValue({ payments: [paymentRows[1]], pagination: pageInfo(1, 1), summary: paymentSummary });
      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'PAID' } });

      await waitFor(() => expect(lastCall(paymentsMock.listOverview)).toEqual({ page: 1, pageSize: 20, q: '', status: 'PAID' }));
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(screen.getByText('1 registro')).toBeTruthy();
      expect(text(metric('Recebido'))).toContain('R$ 200,00');
    });

    it('shows the empty state and a permission error', async () => {
      paymentsMock.listOverview.mockResolvedValueOnce({ payments: [], pagination: pageInfo(1, 0), summary: { paidTotal: '0.00', pendingTotal: '0.00', count: 0 } }).mockRejectedValueOnce(new ApiError('You do not have permission to perform this action', 403));
      const first = renderPage('payments');
      expect(await screen.findByText('Nenhum pagamento registrado.')).toBeTruthy();
      first.unmount();
      renderPage('payments');
      expect((await screen.findByRole('alert')).textContent).toContain('Você não tem permissão');
    });
  });

  describe('warranties', () => {
    it('loads one page with a single request and shows the counts from the server', async () => {
      renderPage('warranties');
      await screen.findByRole('table');

      expect(warrantiesMock.listOverview).toHaveBeenCalledTimes(1);
      expectNoPerOrderCalls();
      expect(text(metric('Garantias ativas'))).toContain('1');
      expect(text(metric('Garantias expiradas'))).toContain('1');
      expect(text(metric('Total de garantias'))).toContain('2');
      expect(screen.getByText('Garantia vigente')).toBeTruthy();
    });

    it('filters by status on the server and shows the empty state', async () => {
      const view = renderPage('warranties');
      await screen.findByRole('table');
      warrantiesMock.listOverview.mockResolvedValue({ warranties: [warrantyRows[0]], pagination: pageInfo(1, 1), summary: warrantySummary });
      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'EXPIRED' } });

      await waitFor(() => expect(lastCall(warrantiesMock.listOverview)).toEqual({ page: 1, pageSize: 20, q: '', status: 'EXPIRED' }));
      expect(await screen.findByText('Garantia vencida')).toBeTruthy();
      expect(screen.queryByText('Garantia vigente')).toBeNull();
      view.unmount();

      warrantiesMock.listOverview.mockResolvedValue({ warranties: [], pagination: pageInfo(1, 0), summary: { active: 0, expired: 0, total: 0 } });
      renderPage('warranties');
      expect(await screen.findByText('Nenhuma garantia cadastrada.')).toBeTruthy();
    });
  });
});
