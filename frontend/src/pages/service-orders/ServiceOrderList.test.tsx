import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ServiceOrder } from '../../types/service-order';

const serviceOrderServiceMock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../services/service-orders', () => ({ serviceOrdersService: serviceOrderServiceMock }));

import { ServiceOrderList } from './ServiceOrderList';

const order: ServiceOrder = {
  id: 'order-1', organizationId: 'organization-1', customerId: 'customer-1', equipmentId: 'equipment-1', orderNumber: 'OS-1', status: 'RECEIVED',
  problemDescription: 'Tela não liga', technicianNotes: null, estimatedValue: null, finalValue: null, receivedAt: '2026-10-15T10:00:00.000Z', completedAt: null,
  createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', customer: { id: 'customer-1', name: 'Alice Silva' }, equipment: { id: 'equipment-1', type: 'Notebook', brand: 'Dell', model: 'Inspiron' },
};

function renderPage() {
  return render(<MemoryRouter><ServiceOrderList /></MemoryRouter>);
}

describe('ServiceOrderList', () => {
  beforeEach(() => {
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
});
