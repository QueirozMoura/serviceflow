import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from '../../services/api';
import type { Diagnosis, ServiceOrder } from '../../types/service-order';

const serviceOrderServiceMock = vi.hoisted(() => ({ get: vi.fn(), updateStatus: vi.fn(), remove: vi.fn(), getDiagnosis: vi.fn(), createDiagnosis: vi.fn(), updateDiagnosis: vi.fn(), removeDiagnosis: vi.fn(), generateMessage: vi.fn() }));
const quotesServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
const paymentsServiceMock = vi.hoisted(() => ({ list: vi.fn() }));
const warrantiesServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/service-orders', () => ({ serviceOrdersService: serviceOrderServiceMock }));
vi.mock('../../services/quotes', () => ({ quotesService: quotesServiceMock }));
vi.mock('../../services/payments', () => ({ paymentsService: paymentsServiceMock }));
vi.mock('../../services/warranties', () => ({ warrantiesService: warrantiesServiceMock }));

import { ServiceOrderDetails } from './ServiceOrderDetails';

const order: ServiceOrder = {
  id: 'order-1', organizationId: 'organization-1', customerId: 'customer-1', equipmentId: 'equipment-1', orderNumber: 'OS-1', status: 'WAITING_DIAGNOSIS',
  problemDescription: 'Tela não liga', technicianNotes: null, estimatedValue: null, finalValue: null, receivedAt: '2026-10-15T10:00:00.000Z', completedAt: null,
  createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', customer: { id: 'customer-1', name: 'Alice Silva' }, equipment: { id: 'equipment-1', type: 'Notebook', brand: 'Dell', model: 'Inspiron' },
};
const diagnosis: Diagnosis = { id: 'diagnosis-1', serviceOrderId: 'order-1', description: 'Placa de vídeo danificada', estimatedCost: '150', createdAt: '2026-10-15T11:00:00.000Z', updatedAt: '2026-10-15T11:00:00.000Z' };
const notFound = () => new ApiError('Not found', 404);

function ListProbe() {
  const location = useLocation();
  return <div>Lista de OS: {(location.state as { message?: string } | null)?.message}</div>;
}

function renderPage() {
  return render(<MemoryRouter initialEntries={['/service-orders/order-1']}><Routes><Route path="/service-orders/:id" element={<ServiceOrderDetails />} /><Route path="/service-orders" element={<ListProbe />} /></Routes></MemoryRouter>);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function openDiagnosisForm(label: 'Adicionar diagnóstico' | 'Editar diagnóstico') {
  fireEvent.click(await screen.findByRole('button', { name: label }));
  return { description: screen.getByLabelText(/Descrição do diagnóstico/), cost: screen.getByLabelText('Custo estimado') };
}

describe('ServiceOrderDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceOrderServiceMock.get.mockResolvedValue({ serviceOrder: order });
    serviceOrderServiceMock.getDiagnosis.mockRejectedValue(notFound());
    quotesServiceMock.get.mockRejectedValue(notFound());
    paymentsServiceMock.list.mockResolvedValue({ payments: [] });
    warrantiesServiceMock.get.mockRejectedValue(notFound());
  });

  describe('diagnóstico', () => {
    it('shows the existing diagnosis returned by the API', async () => {
      serviceOrderServiceMock.getDiagnosis.mockResolvedValue({ diagnosis });
      renderPage();

      expect(await screen.findByText('Placa de vídeo danificada')).toBeTruthy();
      expect(screen.getByText(/Custo estimado: R\$\s150,00/)).toBeTruthy();
      expect(serviceOrderServiceMock.getDiagnosis).toHaveBeenCalledWith('order-1');
    });

    it('validates required and monetary fields before sending', async () => {
      renderPage();
      expect(await screen.findByText('Nenhum diagnóstico cadastrado.')).toBeTruthy();
      const fields = await openDiagnosisForm('Adicionar diagnóstico');

      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));
      expect(screen.getByRole('alert').textContent).toContain('pelo menos 2 caracteres');

      fireEvent.change(fields.description, { target: { value: 'Fonte queimada' } });
      fireEvent.change(fields.cost, { target: { value: 'R$ abc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));
      expect(screen.getByRole('alert').textContent).toContain('custo estimado válido');
      expect(serviceOrderServiceMock.createDiagnosis).not.toHaveBeenCalled();
    });

    it('creates a diagnosis with a normalized cost and shows the saved data', async () => {
      serviceOrderServiceMock.createDiagnosis.mockResolvedValue({ diagnosis: { ...diagnosis, description: 'Fonte queimada', estimatedCost: '1234.56' } });
      renderPage();
      const fields = await openDiagnosisForm('Adicionar diagnóstico');

      fireEvent.change(fields.description, { target: { value: '  Fonte queimada  ' } });
      fireEvent.change(fields.cost, { target: { value: '1.234,56' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));

      expect(await screen.findByText('Fonte queimada')).toBeTruthy();
      expect(serviceOrderServiceMock.createDiagnosis).toHaveBeenCalledWith('order-1', { description: 'Fonte queimada', estimatedCost: '1234.56' });
      expect(screen.getByText(/R\$\s1\.234,56/)).toBeTruthy();
      expect(screen.getByText('Diagnóstico registrado.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Editar diagnóstico' })).toBeTruthy();
    });

    it('blocks duplicate submissions while saving', async () => {
      const pending = deferred<{ diagnosis: Diagnosis }>();
      serviceOrderServiceMock.createDiagnosis.mockReturnValue(pending.promise);
      renderPage();
      const fields = await openDiagnosisForm('Adicionar diagnóstico');
      fireEvent.change(fields.description, { target: { value: 'Fonte queimada' } });

      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));
      const saving = screen.getByRole('button', { name: 'Salvando...' }) as HTMLButtonElement;
      expect(saving.disabled).toBe(true);
      fireEvent.click(saving);
      fireEvent.submit(saving.closest('form')!);
      expect(serviceOrderServiceMock.createDiagnosis).toHaveBeenCalledTimes(1);

      await act(async () => { pending.resolve({ diagnosis: { ...diagnosis, description: 'Fonte queimada' } }); });
      expect(await screen.findByText('Fonte queimada')).toBeTruthy();
    });

    it('sends only changed fields when editing and skips the request when nothing changed', async () => {
      serviceOrderServiceMock.getDiagnosis.mockResolvedValue({ diagnosis });
      serviceOrderServiceMock.updateDiagnosis.mockResolvedValue({ diagnosis: { ...diagnosis, description: 'Placa e conector danificados' } });
      renderPage();

      await openDiagnosisForm('Editar diagnóstico');
      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));
      expect(serviceOrderServiceMock.updateDiagnosis).not.toHaveBeenCalled();
      expect(screen.queryByLabelText(/Descrição do diagnóstico/)).toBeNull();

      const fields = await openDiagnosisForm('Editar diagnóstico');
      expect((fields.cost as HTMLInputElement).value).toBe('150');
      fireEvent.change(fields.description, { target: { value: 'Placa e conector danificados' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));

      expect(await screen.findByText('Placa e conector danificados')).toBeTruthy();
      expect(serviceOrderServiceMock.updateDiagnosis).toHaveBeenCalledWith('order-1', { description: 'Placa e conector danificados' });
      expect(screen.getByText('Diagnóstico atualizado.')).toBeTruthy();
    });

    it('sends null when the estimated cost is cleared', async () => {
      serviceOrderServiceMock.getDiagnosis.mockResolvedValue({ diagnosis });
      serviceOrderServiceMock.updateDiagnosis.mockResolvedValue({ diagnosis: { ...diagnosis, estimatedCost: null } });
      renderPage();

      const fields = await openDiagnosisForm('Editar diagnóstico');
      fireEvent.change(fields.cost, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));

      expect(await screen.findByText('Custo estimado: Não informado')).toBeTruthy();
      expect(serviceOrderServiceMock.updateDiagnosis).toHaveBeenCalledWith('order-1', { estimatedCost: null });
    });

    it('keeps the typed data and shows the API error when saving fails', async () => {
      serviceOrderServiceMock.getDiagnosis.mockResolvedValue({ diagnosis });
      serviceOrderServiceMock.updateDiagnosis.mockRejectedValue(new ApiError('Invalid diagnosis data', 400));
      renderPage();

      const fields = await openDiagnosisForm('Editar diagnóstico');
      fireEvent.change(fields.description, { target: { value: 'Novo texto' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));

      expect((await screen.findByRole('alert')).textContent).toContain('Revise os dados do diagnóstico');
      expect((screen.getByLabelText(/Descrição do diagnóstico/) as HTMLTextAreaElement).value).toBe('Novo texto');
      expect((screen.getByRole('button', { name: 'Salvar diagnóstico' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('reloads the diagnosis when the API reports it already exists', async () => {
      serviceOrderServiceMock.createDiagnosis.mockRejectedValue(new ApiError('Diagnosis already exists for this service order', 409));
      renderPage();
      const fields = await openDiagnosisForm('Adicionar diagnóstico');
      serviceOrderServiceMock.getDiagnosis.mockResolvedValue({ diagnosis });

      fireEvent.change(fields.description, { target: { value: 'Fonte queimada' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));

      expect((await screen.findByRole('alert')).textContent).toContain('já possui um diagnóstico');
      await waitFor(() => expect(serviceOrderServiceMock.getDiagnosis).toHaveBeenCalledTimes(2));
      expect((screen.getByLabelText(/Descrição do diagnóstico/) as HTMLTextAreaElement).value).toBe('Fonte queimada');
      serviceOrderServiceMock.updateDiagnosis.mockResolvedValue({ diagnosis: { ...diagnosis, description: 'Fonte queimada' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar diagnóstico' }));
      await waitFor(() => expect(serviceOrderServiceMock.updateDiagnosis).toHaveBeenCalledWith('order-1', { description: 'Fonte queimada', estimatedCost: null }));
    });

    it('deletes the diagnosis after confirmation', async () => {
      serviceOrderServiceMock.getDiagnosis.mockResolvedValue({ diagnosis });
      serviceOrderServiceMock.removeDiagnosis.mockResolvedValue(undefined);
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Excluir diagnóstico' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

      expect(await screen.findByText('Nenhum diagnóstico cadastrado.')).toBeTruthy();
      expect(serviceOrderServiceMock.removeDiagnosis).toHaveBeenCalledWith('order-1');
    });
  });

  describe('exclusão da OS', () => {
    it('asks for confirmation and does nothing when cancelled', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /Excluir OS/ }));

      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('A ordem OS-1 será removida permanentemente');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(serviceOrderServiceMock.remove).not.toHaveBeenCalled();
    });

    it('blocks duplicate confirmations and returns to the list after deleting', async () => {
      const pending = deferred<void>();
      serviceOrderServiceMock.remove.mockReturnValue(pending.promise);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /Excluir OS/ }));

      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
      const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluindo...' }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.click(confirm);
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar' }));
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(serviceOrderServiceMock.remove).toHaveBeenCalledTimes(1);
      expect(serviceOrderServiceMock.remove).toHaveBeenCalledWith('order-1');

      await act(async () => { pending.resolve(); });
      expect(await screen.findByText('Lista de OS: OS-1 excluída.')).toBeTruthy();
    });

    it('keeps the order on screen and explains a 409 from the API', async () => {
      serviceOrderServiceMock.remove.mockRejectedValue(new ApiError('Service order cannot be deleted while it has related records', 409));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /Excluir OS/ }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

      expect(await screen.findByText(/possui histórico ou registros vinculados/)).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('heading', { name: 'OS-1' })).toBeTruthy();
      expect(screen.getByText('Tela não liga')).toBeTruthy();
      expect(screen.queryByText(/Lista de OS/)).toBeNull();
    });

    it('shows a generic message when the request fails without an API response', async () => {
      serviceOrderServiceMock.remove.mockRejectedValue(new TypeError('Failed to fetch'));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /Excluir OS/ }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

      expect(await screen.findByText(/Verifique sua conexão/)).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'OS-1' })).toBeTruthy();
    });
  });
});
