import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../services/api';
import type { Customer } from '../../types/customer';
import { pageInfo, pageOf } from '../../test/paging';

const customerServiceMock = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));
vi.mock('../../services/customers', () => ({ customersService: customerServiceMock }));
const authMock = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ can: (permission: string) => !authMock.denied.has(permission) }) }));

import { CustomerList } from './CustomerList';

const customer: Customer = {
  id: 'customer-1', organizationId: 'organization-1', name: 'Alice Silva', email: 'alice@example.com', phone: '11999999999',
  document: null, address: null, notes: null, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};

function renderPage() {
  return render(<MemoryRouter><CustomerList /></MemoryRouter>);
}

const many = (count: number): Customer[] => Array.from({ length: count }, (_, index) => ({ ...customer, id: `customer-${index + 1}`, name: `Cliente ${String(index + 1).padStart(2, '0')}`, email: `c${index + 1}@example.com` }));
// Servidor simulado: filtra por q e fatia pela pagina pedida, como o backend.
function serve(all: Customer[]) {
  customerServiceMock.list.mockImplementation(async (params: { page: number; pageSize: number; q?: string }) => {
    const matches = all.filter((item) => !params.q || item.name.toLowerCase().includes(params.q.toLowerCase()));
    const { items, pagination } = pageOf(matches, params);
    return { customers: items, pagination };
  });
}
const lastCall = () => customerServiceMock.list.mock.calls.at(-1)?.[0];
const typeSearch = (value: string) => fireEvent.change(screen.getByLabelText('Buscar cliente por nome, telefone ou email'), { target: { value } });

describe('CustomerList', () => {
  beforeEach(() => {
    authMock.denied.clear();
    vi.clearAllMocks();
    customerServiceMock.remove.mockResolvedValue(undefined);
    serve([customer]);
  });

  it('shows loading and then the loaded customer list', async () => {
    let resolveList: (value: unknown) => void = () => undefined;
    customerServiceMock.list.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    renderPage();

    expect(screen.getByRole('status').textContent).toContain('Carregando clientes');
    await act(async () => { resolveList({ customers: [customer], pagination: pageInfo(1, 1) }); });
    expect(await screen.findByText('Alice Silva')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(customerServiceMock.list).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '' });
  });

  it('shows the empty state when the API returns no customers', async () => {
    serve([]);
    renderPage();

    expect(await screen.findByText('Nenhum cliente encontrado')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Novo cliente' }).some((link) => link.getAttribute('href') === '/customers/new')).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
  });

  it('shows an API error with a retry action that loads again', async () => {
    customerServiceMock.list.mockRejectedValueOnce(new Error('network failure'));
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar os clientes');
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Alice Silva')).toBeTruthy();
    expect(customerServiceMock.list).toHaveBeenCalledTimes(2);
  });

  describe('pagination', () => {
    it('shows the range, the page and the totals sent by the server', async () => {
      serve(many(45));
      renderPage();

      await screen.findByText('Cliente 01');
      expect(screen.getByText('45 clientes')).toBeTruthy();
      expect(screen.getByText('Mostrando 1–20 de 45 clientes')).toBeTruthy();
      expect(screen.getByText('Página 1 de 3')).toBeTruthy();
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(20);
      expect((screen.getByRole('button', { name: /Anterior/ }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: /Próxima/ }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('requests the next and previous pages from the server instead of paging in memory', async () => {
      serve(many(45));
      renderPage();
      await screen.findByText('Cliente 01');

      fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      expect(await screen.findByText('Cliente 21')).toBeTruthy();
      expect(lastCall()).toEqual({ page: 2, pageSize: 20, q: '' });
      expect(screen.queryByText('Cliente 01')).toBeNull();
      expect(screen.getByText('Mostrando 21–40 de 45 clientes')).toBeTruthy();
      expect(screen.getByText('Página 2 de 3')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      expect(await screen.findByText('Cliente 41')).toBeTruthy();
      expect(screen.getByText('Mostrando 41–45 de 45 clientes')).toBeTruthy();
      expect((screen.getByRole('button', { name: /Próxima/ }) as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /Anterior/ }));
      expect(await screen.findByText('Cliente 21')).toBeTruthy();
      expect(lastCall()).toEqual({ page: 2, pageSize: 20, q: '' });
      expect(customerServiceMock.list).toHaveBeenCalledTimes(4);
    });

    it('disables the page controls while a page is loading', async () => {
      serve(many(45));
      renderPage();
      await screen.findByText('Cliente 01');
      let resolveNext: (value: unknown) => void = () => undefined;
      customerServiceMock.list.mockReturnValueOnce(new Promise((resolve) => { resolveNext = resolve; }));

      fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      expect(screen.getByRole('status').textContent).toContain('Carregando clientes');
      expect((screen.getByRole('button', { name: /Próxima/ }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: /Anterior/ }) as HTMLButtonElement).disabled).toBe(true);

      await act(async () => { resolveNext({ customers: many(45).slice(20, 40), pagination: pageInfo(2, 45) }); });
      expect(await screen.findByText('Cliente 21')).toBeTruthy();
    });
  });

  describe('search', () => {
    it('waits for a pause in typing, then searches on the server from the first page', async () => {
      serve(many(45));
      renderPage();
      await screen.findByText('Cliente 01');
      fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      await screen.findByText('Cliente 21');
      const callsBefore = customerServiceMock.list.mock.calls.length;

      typeSearch('c'); typeSearch('cl'); typeSearch('cliente 3');
      expect(customerServiceMock.list.mock.calls.length).toBe(callsBefore);
      await waitFor(() => expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: 'cliente 3' }), { timeout: 2000 });
      expect(customerServiceMock.list.mock.calls.length).toBe(callsBefore + 1);
      expect(await screen.findByText('Cliente 30')).toBeTruthy();
      expect(screen.getByText('10 clientes')).toBeTruthy();
      expect(screen.queryByText('Cliente 21')).toBeNull();
      expect(screen.getByText('Página 1 de 1')).toBeTruthy();
    });

    it('shows a no-results message with a way to clear the filters', async () => {
      serve(many(5));
      renderPage();
      await screen.findByText('Cliente 01');

      typeSearch('zzz');
      expect(await screen.findByText('Nenhum cliente corresponde à busca.', {}, { timeout: 2000 })).toBeTruthy();
      expect(screen.getByText('0 clientes')).toBeTruthy();
      expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
      expect(await screen.findByText('Cliente 01')).toBeTruthy();
      expect((screen.getByLabelText('Buscar cliente por nome, telefone ou email') as HTMLInputElement).value).toBe('');
      expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '' });
      expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
    });

    it('ignores a slow response that arrives after a newer search', async () => {
      serve(many(5));
      renderPage();
      await screen.findByText('Cliente 01');
      let resolveSlow: (value: unknown) => void = () => undefined;
      customerServiceMock.list.mockReturnValueOnce(new Promise((resolve) => { resolveSlow = resolve; }));

      typeSearch('cliente 01');
      await waitFor(() => expect(lastCall()).toMatchObject({ q: 'cliente 01' }), { timeout: 2000 });
      typeSearch('cliente 05');
      expect(await screen.findByText('Cliente 05', {}, { timeout: 2000 })).toBeTruthy();
      await act(async () => { resolveSlow({ customers: many(5).slice(0, 1), pagination: pageInfo(1, 1) }); });

      expect(screen.getByText('Cliente 05')).toBeTruthy();
      expect(screen.queryByText('Cliente 01')).toBeNull();
    });
  });

  describe('actions', () => {
    it('confirms and removes a customer, then reloads the current page from the server', async () => {
      renderPage();

      await screen.findByText('Alice Silva');
      fireEvent.click(screen.getByRole('button', { name: 'Excluir Alice Silva' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Excluir cliente?')).toBeTruthy();
      serve([]);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

      await waitFor(() => expect(customerServiceMock.remove).toHaveBeenCalledWith('customer-1'));
      expect((await screen.findByRole('status')).textContent).toContain('Cliente excluído com sucesso');
      expect(await screen.findByText('Nenhum cliente encontrado')).toBeTruthy();
      expect(customerServiceMock.list).toHaveBeenCalledTimes(2);
    });

    it('moves back to the last existing page when deleting empties the current one', async () => {
      const all = many(21);
      serve(all);
      renderPage();
      await screen.findByText('Cliente 01');
      fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      await screen.findByText('Cliente 21');

      fireEvent.click(screen.getByRole('button', { name: 'Excluir Cliente 21' }));
      serve(all.slice(0, 20));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

      expect(await screen.findByText('Cliente 20')).toBeTruthy();
      expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '' });
      expect(screen.getByText('Página 1 de 1')).toBeTruthy();
    });

    it('keeps the customer and reports a conflict when deletion fails', async () => {
      customerServiceMock.remove.mockRejectedValue(new ApiError('Conflict', 409));
      renderPage();

      await screen.findByText('Alice Silva');
      fireEvent.click(screen.getByRole('button', { name: 'Excluir Alice Silva' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

      expect((await screen.findByRole('status')).textContent).toContain('Não é possível excluir este cliente');
      expect(screen.getByText('Alice Silva')).toBeTruthy();
      expect(customerServiceMock.list).toHaveBeenCalledTimes(1);
    });

    it('hides the delete action from a role without customers:delete', async () => {
      authMock.denied.add('customers:delete');
      renderPage();

      await screen.findByText('Alice Silva');
      expect(screen.queryByRole('button', { name: /Excluir/ })).toBeNull();
      expect(screen.getByRole('link', { name: 'Editar Alice Silva' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Ver Alice Silva' })).toBeTruthy();
    });

    it('explains a 403 returned by the API when deleting', async () => {
      customerServiceMock.remove.mockRejectedValue(new ApiError('You do not have permission to perform this action', 403));
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Excluir Alice Silva' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

      expect(await screen.findByText('Você não tem permissão para excluir este registro.')).toBeTruthy();
      expect(screen.getByText('Alice Silva')).toBeTruthy();
    });
  });
});
