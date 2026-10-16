import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { pageInfo, pageOf } from '../../test/paging';
import type { ServiceOrder } from '../../types/service-order';

const serviceOrderServiceMock = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));
vi.mock('../../services/service-orders', () => ({ serviceOrdersService: serviceOrderServiceMock }));
const authMock = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ can: (permission: string) => !authMock.denied.has(permission) }) }));

import { ServiceOrderList } from './ServiceOrderList';

const order: ServiceOrder = {
  id: 'order-1', organizationId: 'organization-1', customerId: 'customer-1', equipmentId: 'equipment-1', orderNumber: 'OS-1', status: 'RECEIVED',
  problemDescription: 'Tela não liga', technicianNotes: null, estimatedValue: null, finalValue: null, receivedAt: '2026-10-15T10:00:00.000Z', completedAt: null,
  createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', customer: { id: 'customer-1', name: 'Alice Silva' }, equipment: { id: 'equipment-1', type: 'Notebook', brand: 'Dell', model: 'Inspiron' },
};

const secondOrder: ServiceOrder = { ...order, id: 'order-2', orderNumber: 'OS-2', customer: { id: 'customer-2', name: 'Bruno Lima' } };

function renderPage(state?: { message: string }) {
  return render(<MemoryRouter initialEntries={[{ pathname: '/service-orders', state }]}><ServiceOrderList /></MemoryRouter>);
}

async function requestDelete(orderNumber: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Excluir ${orderNumber}` }));
  return screen.getByRole('dialog');
}

const many = (count: number): ServiceOrder[] => Array.from({ length: count }, (_, index) => ({ ...order, id: `order-${index + 1}`, orderNumber: `OS-${String(index + 1).padStart(3, '0')}`, status: index % 2 ? 'DELIVERED' : 'RECEIVED' }));
function serve(all: ServiceOrder[]) {
  serviceOrderServiceMock.list.mockImplementation(async (params: { page: number; pageSize: number; q?: string; status?: string }) => {
    const matches = all.filter((item) => (!params.status || item.status === params.status) && (!params.q || item.orderNumber.toLowerCase().includes(params.q.toLowerCase()) || item.customer.name.toLowerCase().includes(params.q.toLowerCase())));
    const { items, pagination } = pageOf(matches, params);
    return { serviceOrders: items, pagination };
  });
}
const lastCall = () => serviceOrderServiceMock.list.mock.calls.at(-1)?.[0];
const typeSearch = (value: string) => fireEvent.change(screen.getByLabelText('Buscar OS, cliente ou equipamento'), { target: { value } });

describe('ServiceOrderList', () => {
  beforeEach(() => {
    authMock.denied.clear();
    vi.clearAllMocks();
    serviceOrderServiceMock.remove.mockResolvedValue(undefined);
    serve([order]);
  });

  it('shows loading and the loaded order', async () => {
    let resolveList: (value: unknown) => void = () => undefined;
    serviceOrderServiceMock.list.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    renderPage();

    expect(screen.getByRole('status').textContent).toContain('Carregando ordens');
    await act(async () => { resolveList({ serviceOrders: [order], pagination: pageInfo(1, 1) }); });
    expect((await screen.findAllByText('OS-1')).length).toBeGreaterThan(0);
    expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', status: undefined });
  });

  it('shows the empty state and create action', async () => {
    serve([]);
    renderPage();

    expect(await screen.findByText('Nenhuma ordem de serviço encontrada')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Criar primeira OS|Nova OS/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();
  });

  it('shows API errors with a retry that loads again', async () => {
    serviceOrderServiceMock.list.mockRejectedValueOnce(new Error('network failure'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as ordens');

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findAllByText('OS-1');
    expect(serviceOrderServiceMock.list).toHaveBeenCalledTimes(2);
  });

  it('explains an expired session', async () => {
    serviceOrderServiceMock.list.mockRejectedValueOnce(new ApiError('Authentication required', 401));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Sua sessão expirou');
  });

  describe('pagination and filters', () => {
    it('shows the range and totals sent by the server and pages on the server', async () => {
      serve(many(45));
      renderPage();

      await screen.findAllByText('OS-001');
      expect(screen.getByText('45 ordens')).toBeTruthy();
      expect(screen.getByText('Mostrando 1–20 de 45 ordens')).toBeTruthy();
      expect(screen.getByText('Página 1 de 3')).toBeTruthy();
      expect((screen.getByRole('button', { name: /Anterior/ }) as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      expect((await screen.findAllByText('OS-021')).length).toBeGreaterThan(0);
      expect(lastCall()).toEqual({ page: 2, pageSize: 20, q: '', status: undefined });
      expect(screen.queryByText('OS-001')).toBeNull();
      expect(screen.getByText('Mostrando 21–40 de 45 ordens')).toBeTruthy();
    });

    it('sends the selected status to the server, returning to the first page', async () => {
      serve(many(45));
      renderPage();
      await screen.findAllByText('OS-001');
      fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      await screen.findAllByText('OS-021');

      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'DELIVERED' } });

      await waitFor(() => expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', status: 'DELIVERED' }));
      expect(await screen.findByText('22 ordens')).toBeTruthy();
      expect(screen.getByText('Página 1 de 2')).toBeTruthy();
    });

    it('combines search and status, and clears both at once', async () => {
      serve(many(45));
      renderPage();
      await screen.findAllByText('OS-001');

      typeSearch('os-00');
      fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'RECEIVED' } });
      await waitFor(() => expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: 'os-00', status: 'RECEIVED' }), { timeout: 2000 });
      expect(await screen.findByText('5 ordens')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
      expect(await screen.findByText('45 ordens')).toBeTruthy();
      expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', status: undefined });
      expect((screen.getByLabelText('Filtrar por status') as HTMLSelectElement).value).toBe('');
    });

    it('shows a no-results message when the filters match nothing', async () => {
      serve(many(5));
      renderPage();
      await screen.findAllByText('OS-001');

      typeSearch('inexistente');
      expect(await screen.findByText('Nenhuma OS encontrada para essa busca.', {}, { timeout: 2000 })).toBeTruthy();
      expect(screen.getByText('0 ordens')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeTruthy();
    });
  });

  it('shows the message sent by the details page after a deletion', async () => {
    renderPage({ message: 'OS-9 excluída.' });
    expect(await screen.findByText('OS-9 excluída.')).toBeTruthy();
  });

  it('asks for confirmation and keeps the order when deletion is cancelled', async () => {
    renderPage();
    const dialog = await requestDelete('OS-1');

    expect(dialog.textContent).toContain('A ordem OS-1 será removida permanentemente');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(serviceOrderServiceMock.remove).not.toHaveBeenCalled();
    expect(screen.getAllByText('OS-1').length).toBeGreaterThan(0);
  });

  it('reloads the page from the server after a successful deletion, showing only the remaining order', async () => {
    serve([order, secondOrder]);
    renderPage();
    const dialog = await requestDelete('OS-1');
    serve([secondOrder]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText('OS-1 excluída.')).toBeTruthy();
    expect(serviceOrderServiceMock.remove).toHaveBeenCalledWith('order-1');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'OS-1' })).toBeNull());
    expect(screen.getAllByText('OS-2').length).toBeGreaterThan(0);
    expect(screen.getByText('1 ordem')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(serviceOrderServiceMock.list).toHaveBeenCalledTimes(2);
  });

  it('blocks duplicate deletions while the request is pending', async () => {
    let resolveRemove: () => void = () => undefined;
    serviceOrderServiceMock.remove.mockReturnValue(new Promise<void>((resolve) => { resolveRemove = resolve; }));
    renderPage();
    const dialog = await requestDelete('OS-1');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    const confirm = within(dialog).getByRole('button', { name: 'Excluindo...' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Excluir OS-1' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(serviceOrderServiceMock.remove).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRemove(); });
    expect(await screen.findByText('OS-1 excluída.')).toBeTruthy();
  });

  it('keeps the list intact and explains a blocked deletion', async () => {
    serviceOrderServiceMock.remove.mockRejectedValue(new ApiError('Service order cannot be deleted while it has related records', 409));
    renderPage();
    const dialog = await requestDelete('OS-1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText(/possui histórico ou registros vinculados/)).toBeTruthy();
    expect(screen.getAllByText('OS-1').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(serviceOrderServiceMock.list).toHaveBeenCalledTimes(1);
  });

  it('refreshes the list when the order no longer exists on the server', async () => {
    serviceOrderServiceMock.remove.mockRejectedValue(new ApiError('Service order not found', 404));
    renderPage();
    const dialog = await requestDelete('OS-1');
    serve([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText(/não foi encontrada/)).toBeTruthy();
    expect(await screen.findByText('Nenhuma ordem de serviço encontrada')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'OS-1' })).toBeNull();
  });

  it('hides the delete action from a role without serviceOrders:delete', async () => {
    authMock.denied.add('serviceOrders:delete');
    renderPage();

    await screen.findAllByText('OS-1');
    expect(screen.queryByRole('button', { name: 'Excluir OS-1' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Ver OS-1' }).length).toBeGreaterThan(0);
  });

  it('explains a 403 returned by the API when deleting', async () => {
    serviceOrderServiceMock.remove.mockRejectedValue(new ApiError('You do not have permission to perform this action', 403));
    renderPage();
    const dialog = await requestDelete('OS-1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText('Você não tem permissão para excluir ordens de serviço.')).toBeTruthy();
    expect(screen.getAllByText('OS-1').length).toBeGreaterThan(0);
  });
});
