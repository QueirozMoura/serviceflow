import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Customer } from '../../types/customer';
import { ApiError } from '../../services/api';
import { pageInfo, pageOf } from '../../test/paging';
import type { Equipment } from '../../types/equipment';

const equipmentServiceMock = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));
const customerServiceMock = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock('../../services/equipment', () => ({ equipmentService: equipmentServiceMock }));
vi.mock('../../services/customers', () => ({ customersService: customerServiceMock }));
const authMock = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ can: (permission: string) => !authMock.denied.has(permission) }) }));

import { EquipmentList } from './EquipmentList';

const customer: Customer = {
  id: 'customer-1', organizationId: 'organization-1', name: 'Alice Silva', email: 'alice@example.com', phone: '11999999999',
  document: null, address: null, notes: null, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};
const equipment: Equipment = {
  id: 'equipment-1', organizationId: 'organization-1', customerId: 'customer-1', type: 'Notebook', brand: 'Dell', model: 'Inspiron', serialNumber: 'SN-1', description: null,
  customer: { id: customer.id, name: customer.name }, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};

function renderPage() {
  return render(<MemoryRouter><EquipmentList /></MemoryRouter>);
}

const many = (count: number): Equipment[] => Array.from({ length: count }, (_, index) => ({ ...equipment, id: `equipment-${index + 1}`, model: `Modelo ${String(index + 1).padStart(2, '0')}`, serialNumber: `SN-${index + 1}` }));
function serve(all: Equipment[]) {
  equipmentServiceMock.list.mockImplementation(async (params: { page: number; pageSize: number; q?: string; customerId?: string }) => {
    const matches = all.filter((item) => (!params.customerId || item.customerId === params.customerId) && (!params.q || (item.model ?? '').toLowerCase().includes(params.q.toLowerCase())));
    const { items, pagination } = pageOf(matches, params);
    return { equipment: items, pagination };
  });
}
const lastCall = () => equipmentServiceMock.list.mock.calls.at(-1)?.[0];

describe('EquipmentList', () => {
  beforeEach(() => {
    authMock.denied.clear();
    vi.clearAllMocks();
    customerServiceMock.options.mockResolvedValue({ customers: [{ id: customer.id, name: customer.name, phone: customer.phone }] });
    equipmentServiceMock.remove.mockResolvedValue(undefined);
    serve([equipment]);
  });

  it('loads equipment and exposes its customer relationship', async () => {
    renderPage();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Dell Inspiron')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alice Silva' })).toBeTruthy();
    expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', customerId: undefined });
  });

  it('fills the customer filter from the lightweight options list, not from a paginated list', async () => {
    renderPage();
    await screen.findByText('Dell Inspiron');

    expect(customerServiceMock.options).toHaveBeenCalledTimes(1);
    expect(within(screen.getByLabelText('Filtrar por cliente')).getByRole('option', { name: 'Alice Silva' })).toBeTruthy();
  });

  it('keeps the list working when the customer options fail to load', async () => {
    customerServiceMock.options.mockRejectedValue(new Error('network'));
    renderPage();

    expect(await screen.findByText('Dell Inspiron')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Todos os clientes' })).toBeTruthy();
  });

  it('filters by customer on the server and goes back to the first page', async () => {
    const other = { ...equipment, id: 'equipment-x', customerId: 'customer-2', customer: { id: 'customer-2', name: 'Bruno' }, model: 'Outro' };
    serve([...many(25), other]);
    customerServiceMock.options.mockResolvedValue({ customers: [{ id: 'customer-1', name: 'Alice Silva', phone: '1' }, { id: 'customer-2', name: 'Bruno', phone: '2' }] });
    renderPage();
    await screen.findByText(/Modelo 01$/);
    await screen.findByRole('option', { name: 'Bruno' });
    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
    await screen.findByText(/Modelo 21$/);

    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'customer-2' } });

    await waitFor(() => expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', customerId: 'customer-2' }));
    expect(await screen.findByText(/Outro$/)).toBeTruthy();
    expect(screen.getByText('1 equipamento')).toBeTruthy();
    expect(screen.queryByText(/Modelo 21$/)).toBeNull();
  });

  it('paginates with the totals from the server', async () => {
    serve(many(45));
    renderPage();

    await screen.findByText(/Modelo 01$/);
    expect(screen.getByText('Mostrando 1–20 de 45 equipamentos')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
    expect(await screen.findByText(/Modelo 21$/)).toBeTruthy();
    expect(lastCall()).toMatchObject({ page: 2 });
    expect(screen.getByText('Página 2 de 3')).toBeTruthy();
  });

  it('combines search and customer filter, and clears both with one action', async () => {
    serve(many(25));
    renderPage();
    await screen.findByText(/Modelo 01$/);
    await screen.findByRole('option', { name: 'Alice Silva' });

    fireEvent.change(screen.getByLabelText('Buscar por tipo, marca, modelo ou série'), { target: { value: 'modelo 0' } });
    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: 'customer-1' } });
    await waitFor(() => expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: 'modelo 0', customerId: 'customer-1' }), { timeout: 2000 });
    expect(await screen.findByText('9 equipamentos')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByText('25 equipamentos')).toBeTruthy();
    expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', customerId: undefined });
    expect((screen.getByLabelText('Filtrar por cliente') as HTMLSelectElement).value).toBe('');
  });

  it('shows the empty state, a no-results message and an error with retry', async () => {
    serve([]);
    const first = renderPage();
    expect(await screen.findByText('Nenhum equipamento encontrado')).toBeTruthy();
    first.unmount();

    serve(many(3));
    renderPage();
    await screen.findByText(/Modelo 01$/);
    fireEvent.change(screen.getByLabelText('Buscar por tipo, marca, modelo ou série'), { target: { value: 'zzz' } });
    expect(await screen.findByText('Nenhum equipamento corresponde aos filtros.', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('shows an API error and retry action', async () => {
    equipmentServiceMock.list.mockRejectedValueOnce(new Error('network failure'));
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar os equipamentos');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Dell Inspiron')).toBeTruthy();
  });

  it('reloads the list after a successful deletion', async () => {
    renderPage();
    await screen.findByText('Dell Inspiron');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir equipamento' }));
    serve([]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

    expect((await screen.findByRole('status')).textContent).toContain('Equipamento excluído com sucesso');
    expect(await screen.findByText('Nenhum equipamento encontrado')).toBeTruthy();
    expect(equipmentServiceMock.list).toHaveBeenCalledTimes(2);
  });

  it('keeps the list and explains a conflict or a missing permission when deletion fails', async () => {
    equipmentServiceMock.remove.mockRejectedValueOnce(new ApiError('Conflict', 409)).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    renderPage();
    await screen.findByText('Dell Inspiron');

    fireEvent.click(screen.getByRole('button', { name: 'Excluir equipamento' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText(/existem ordens de serviço vinculadas/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir equipamento' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Você não tem permissão para excluir este registro.')).toBeTruthy();
    expect(screen.getByText('Dell Inspiron')).toBeTruthy();
  });

  it('hides the delete action from a role without equipment:delete', async () => {
    authMock.denied.add('equipment:delete');
    renderPage();

    await screen.findByText('Dell Inspiron');
    expect(screen.queryByRole('button', { name: 'Excluir equipamento' })).toBeNull();
  });

  it('shows the delete action to a role with equipment:delete', async () => {
    renderPage();

    await screen.findByText('Dell Inspiron');
    expect(screen.getByRole('button', { name: 'Excluir equipamento' })).toBeTruthy();
  });

  it('disables paging while a page is loading', async () => {
    serve(many(45));
    renderPage();
    await screen.findByText(/Modelo 01$/);
    let resolveNext: (value: unknown) => void = () => undefined;
    equipmentServiceMock.list.mockReturnValueOnce(new Promise((resolve) => { resolveNext = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));

    expect((screen.getByRole('button', { name: /Próxima/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolveNext({ equipment: many(45).slice(20, 40), pagination: pageInfo(2, 45) }); });
    expect(await screen.findByText(/Modelo 21$/)).toBeTruthy();
  });
});
