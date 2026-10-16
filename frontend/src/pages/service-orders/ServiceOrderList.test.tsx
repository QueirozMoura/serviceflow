import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../services/api';
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

describe('ServiceOrderList', () => {
  beforeEach(() => {
    authMock.denied.clear();
    vi.clearAllMocks();
    serviceOrderServiceMock.list.mockResolvedValue({ serviceOrders: [order] });
  });

  it('shows loading and the loaded order', async () => {
    let resolveList: (value: { serviceOrders: ServiceOrder[] }) => void = () => undefined;
    serviceOrderServiceMock.list.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    renderPage();

    expect(screen.getByRole('status').textContent).toContain('Carregando ordens');
    await act(async () => { resolveList({ serviceOrders: [order] }); });
    expect((await screen.findAllByText('OS-1')).length).toBeGreaterThan(0);
  });

  it('shows the empty state and create action', async () => {
    serviceOrderServiceMock.list.mockResolvedValue({ serviceOrders: [] });
    renderPage();

    expect(await screen.findByText('Nenhuma ordem de serviço encontrada')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Criar primeira OS|Nova OS/ }).length).toBeGreaterThan(0);
  });

  it('shows API errors and sends the selected status filter', async () => {
    serviceOrderServiceMock.list.mockRejectedValueOnce(new Error('network failure')).mockResolvedValue({ serviceOrders: [order] });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as ordens');

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findAllByText('OS-1');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'RECEIVED' } });
    await waitFor(() => expect(serviceOrderServiceMock.list).toHaveBeenLastCalledWith('RECEIVED'));
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

  it('removes only the deleted order after a successful deletion', async () => {
    serviceOrderServiceMock.list.mockResolvedValue({ serviceOrders: [order, secondOrder] });
    serviceOrderServiceMock.remove.mockResolvedValue(undefined);
    renderPage();
    const dialog = await requestDelete('OS-1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText('OS-1 excluída.')).toBeTruthy();
    expect(serviceOrderServiceMock.remove).toHaveBeenCalledWith('order-1');
    expect(screen.queryByRole('link', { name: 'OS-1' })).toBeNull();
    expect(screen.getAllByText('OS-2').length).toBeGreaterThan(0);
    expect(screen.getByText('1 ordem')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
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

  it('drops an order that no longer exists on the server', async () => {
    serviceOrderServiceMock.remove.mockRejectedValue(new ApiError('Service order not found', 404));
    renderPage();
    const dialog = await requestDelete('OS-1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText(/não foi encontrada/)).toBeTruthy();
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
