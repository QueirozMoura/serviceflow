import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import type { MessageHistoryItem } from '../../types/service-order';

const serviceMock = vi.hoisted(() => ({ getMessageHistory: vi.fn(), recordMessage: vi.fn(), generateMessage: vi.fn() }));
vi.mock('../../services/service-orders', () => ({ serviceOrdersService: serviceMock }));

import { CommunicationCard } from './CommunicationCard';

const item = (overrides: Partial<MessageHistoryItem> = {}): MessageHistoryItem => ({
  id: 'message-1', type: 'SERVICE_READY', channel: 'WHATSAPP', status: 'DRAFT', content: 'Olá, Alice! Seu Notebook está pronto para retirada.',
  createdAt: '2026-10-16T14:30:00.000Z', createdBy: { name: 'Tecnico Um' }, recipient: { name: 'Alice Silva' }, ...overrides,
});
const generated = { type: 'SERVICE_RECEIVED' as const, serviceOrderId: 'order-1', customer: { name: 'Alice Silva' }, phone: '5511999999999', message: 'Olá, Alice! Recebemos seu Notebook.' };

function renderCard(props: Partial<{ canGenerate: boolean; canRead: boolean; canWrite: boolean }> = {}) {
  return render(<CommunicationCard serviceOrderId="order-1" canGenerate canRead canWrite {...props} />);
}
async function generateDraft() {
  fireEvent.click(await screen.findByRole('button', { name: 'Gerar mensagem' }));
  await screen.findByText(generated.message);
}
const keyOf = (call: number) => serviceMock.recordMessage.mock.calls[call]?.[2] as string;

describe('CommunicationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock.getMessageHistory.mockResolvedValue({ messages: [], sendingAvailable: false });
    // Cada resposta da API e um objeto novo, como no uso real.
    serviceMock.generateMessage.mockImplementation(async () => ({ ...generated }));
    serviceMock.recordMessage.mockResolvedValue({ message: item({ id: 'message-2', type: 'SERVICE_RECEIVED', content: generated.message }), sendingAvailable: false });
  });

  describe('history', () => {
    it('shows loading, then an empty state with the clear notice that nothing is sent by the system', async () => {
      let resolve: (value: unknown) => void = () => undefined;
      serviceMock.getMessageHistory.mockReturnValue(new Promise((r) => { resolve = r; }));
      renderCard();
      expect(screen.getByRole('status').textContent).toContain('Carregando histórico');

      await act(async () => { resolve({ messages: [], sendingAvailable: false }); });
      expect(await screen.findByText('Nenhuma mensagem registrada para esta OS.')).toBeTruthy();
      expect(screen.getByText(/Envio automático ainda não disponível/)).toBeTruthy();
      expect(serviceMock.getMessageHistory).toHaveBeenCalledTimes(1);
      expect(serviceMock.getMessageHistory).toHaveBeenCalledWith('order-1');
    });

    it('shows channel, type, content, date, author and recipient, always as a draft not sent by the system', async () => {
      serviceMock.getMessageHistory.mockResolvedValue({ messages: [item(), item({ id: 'message-3', channel: 'EMAIL', type: 'QUOTE_READY', content: 'Orçamento pronto.', createdBy: { name: 'Dono' } })], sendingAvailable: false });
      renderCard();

      const list = await screen.findByRole('list', { name: 'Histórico de comunicação' });
      const entries = within(list).getAllByRole('listitem');
      expect(entries).toHaveLength(2);
      expect(entries[0]!.textContent).toContain('WhatsApp · Serviço pronto');
      expect(entries[0]!.textContent).toContain('Olá, Alice! Seu Notebook está pronto para retirada.');
      expect(entries[0]!.textContent).toContain('Registrada por Tecnico Um');
      expect(entries[0]!.textContent).toContain('Destinatário: Alice Silva');
      expect(entries[0]!.textContent).toMatch(/16\/10\/2026/);
      expect(entries[1]!.textContent).toContain('E-mail · Orçamento pronto');
      expect(within(list).getAllByText('Rascunho · não enviada pelo sistema')).toHaveLength(2);
    });

    it('never presents a message as sent, pending or failed', async () => {
      serviceMock.getMessageHistory.mockResolvedValue({ messages: [item()], sendingAvailable: false });
      renderCard();
      await screen.findByRole('list', { name: 'Histórico de comunicação' });

      for (const label of ['Enviada', 'Enviado', 'Pendente', 'Falha', 'Falhou', 'Entregue']) expect(screen.queryByText(new RegExp(`^${label}$`))).toBeNull();
      expect(document.querySelector('.badge-sent, .badge-failed, .badge-pending')).toBeNull();
    });

    it('shows an error with a retry that loads the history again', async () => {
      serviceMock.getMessageHistory.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ messages: [item()], sendingAvailable: false });
      renderCard();
      expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar o histórico');

      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      await screen.findByRole('list', { name: 'Histórico de comunicação' });
      expect(serviceMock.getMessageHistory).toHaveBeenCalledTimes(2);
    });

    it('lets the server decide whether the "sending unavailable" notice is shown', async () => {
      serviceMock.getMessageHistory.mockResolvedValue({ messages: [], sendingAvailable: true });
      renderCard();
      await screen.findByText('Nenhuma mensagem registrada para esta OS.');
      expect(screen.queryByText(/Envio automático ainda não disponível/)).toBeNull();
    });
  });

  describe('recording a draft', () => {
    it('records the generated message with the chosen channel and shows it first in the history', async () => {
      serviceMock.getMessageHistory.mockResolvedValue({ messages: [item()], sendingAvailable: false });
      renderCard();
      await generateDraft();

      fireEvent.change(screen.getByLabelText('Canal da mensagem'), { target: { value: 'EMAIL' } });
      fireEvent.click(screen.getByRole('button', { name: 'Registrar no histórico' }));

      expect(await screen.findByText('Rascunho registrado no histórico.')).toBeTruthy();
      expect(serviceMock.recordMessage).toHaveBeenCalledTimes(1);
      expect(serviceMock.recordMessage).toHaveBeenCalledWith('order-1', { type: 'SERVICE_RECEIVED', channel: 'EMAIL' }, expect.stringMatching(/^[0-9a-f-]{36}$/));
      const entries = within(screen.getByRole('list', { name: 'Histórico de comunicação' })).getAllByRole('listitem');
      expect(entries).toHaveLength(2);
      expect(entries[0]!.textContent).toContain(generated.message);
      expect(entries[0]!.textContent).toContain('Rascunho · não enviada pelo sistema');
      // O texto nunca e enviado pelo cliente: o servidor o gera.
      expect(Object.keys(serviceMock.recordMessage.mock.calls[0]![1] as object).sort()).toEqual(['channel', 'type']);
    });

    it('explains that registering does not send anything', async () => {
      renderCard();
      await generateDraft();
      expect(screen.getByText(/o ServiceFlow não envia a mensagem/)).toBeTruthy();
    });

    it('blocks a second click while the first request is pending', async () => {
      let resolve: (value: unknown) => void = () => undefined;
      serviceMock.recordMessage.mockReturnValue(new Promise((r) => { resolve = r; }));
      renderCard();
      await generateDraft();

      fireEvent.click(screen.getByRole('button', { name: 'Registrar no histórico' }));
      const pending = screen.getByRole('button', { name: 'Registrando...' }) as HTMLButtonElement;
      expect(pending.disabled).toBe(true);
      fireEvent.click(pending);
      expect(serviceMock.recordMessage).toHaveBeenCalledTimes(1);

      await act(async () => { resolve({ message: item({ id: 'message-2', content: generated.message }), sendingAvailable: false }); });
      expect(await screen.findByText('Rascunho registrado no histórico.')).toBeTruthy();
    });

    it('reuses the idempotency key for the same draft and channel, and does not duplicate the entry', async () => {
      renderCard();
      await generateDraft();
      fireEvent.click(screen.getByRole('button', { name: 'Registrar no histórico' }));
      await screen.findByText('Rascunho registrado no histórico.');
      fireEvent.click(screen.getByRole('button', { name: 'Registrar no histórico' }));

      expect(await screen.findByText('Esse rascunho já estava registrado.')).toBeTruthy();
      expect(serviceMock.recordMessage).toHaveBeenCalledTimes(2);
      expect(keyOf(1)).toBe(keyOf(0));
      expect(within(screen.getByRole('list', { name: 'Histórico de comunicação' })).getAllByRole('listitem')).toHaveLength(1);
    });

    it('uses a new key when the channel changes or a new message is generated', async () => {
      renderCard();
      await generateDraft();
      fireEvent.click(screen.getByRole('button', { name: 'Registrar no histórico' }));
      await screen.findByText('Rascunho registrado no histórico.');

      fireEvent.change(screen.getByLabelText('Canal da mensagem'), { target: { value: 'EMAIL' } });
      serviceMock.recordMessage.mockResolvedValue({ message: item({ id: 'message-9', channel: 'EMAIL', content: generated.message }), sendingAvailable: false });
      fireEvent.click(screen.getByRole('button', { name: 'Registrar no histórico' }));
      await waitFor(() => expect(serviceMock.recordMessage).toHaveBeenCalledTimes(2));
      expect(keyOf(1)).not.toBe(keyOf(0));

      fireEvent.click(screen.getByRole('button', { name: 'Gerar mensagem' }));
      await waitFor(() => expect(serviceMock.generateMessage).toHaveBeenCalledTimes(2));
      serviceMock.recordMessage.mockResolvedValue({ message: item({ id: 'message-10', channel: 'EMAIL', content: generated.message }), sendingAvailable: false });
      await waitFor(() => expect((screen.getByRole('button', { name: 'Registrar no histórico' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Registrar no histórico' }));
      await waitFor(() => expect(serviceMock.recordMessage).toHaveBeenCalledTimes(3));
      expect(keyOf(2)).not.toBe(keyOf(1));
    });

    it.each([
      ['a customer without e-mail', new ApiError('Customer has no e-mail address registered', 409), 'O cliente não tem e-mail cadastrado'],
      ['missing template data', new ApiError('Diagnosis is required for this message', 409), 'Faltam dados para registrar'],
      ['a missing permission', new ApiError('You do not have permission to perform this action', 403), 'Você não tem permissão para registrar'],
      ['a persistence failure', new ApiError('Internal server error', 500), 'Nada foi salvo'],
      ['a network failure', new TypeError('Failed to fetch'), 'Nada foi salvo'],
    ])('shows an error and keeps the history unchanged on %s', async (_label, failure, message) => {
      serviceMock.recordMessage.mockRejectedValue(failure);
      renderCard();
      await generateDraft();
      fireEvent.click(screen.getByRole('button', { name: 'Registrar no histórico' }));

      expect((await screen.findByRole('alert')).textContent).toContain(message);
      expect(screen.queryByText('Rascunho registrado no histórico.')).toBeNull();
      expect(screen.getByText('Nenhuma mensagem registrada para esta OS.')).toBeTruthy();
      expect(screen.getByText(generated.message)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Registrar no histórico' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('generating and copying (existing behavior)', () => {
    it('generates the selected template and copies the text', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderCard();
      fireEvent.change(await screen.findByLabelText('Modelo de mensagem'), { target: { value: 'SERVICE_READY' } });
      fireEvent.click(screen.getByRole('button', { name: 'Gerar mensagem' }));
      await screen.findByText(generated.message);
      fireEvent.click(screen.getByRole('button', { name: /Copiar/ }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(generated.message));
      expect(serviceMock.generateMessage).toHaveBeenCalledWith('order-1', 'SERVICE_READY');
      expect(serviceMock.recordMessage).not.toHaveBeenCalled();
    });

    it('explains when the template lacks data', async () => {
      serviceMock.generateMessage.mockRejectedValue(new ApiError('Diagnosis is required for this message', 409));
      renderCard();
      fireEvent.click(await screen.findByRole('button', { name: 'Gerar mensagem' }));
      expect(await screen.findByText('Faltam dados para gerar este modelo de mensagem.')).toBeTruthy();
    });
  });

  describe('permissions', () => {
    it('hides the history and does not request it without messages:read', async () => {
      renderCard({ canRead: false });
      await screen.findByRole('button', { name: 'Gerar mensagem' });
      expect(serviceMock.getMessageHistory).not.toHaveBeenCalled();
      expect(screen.queryByText('Histórico de comunicação')).toBeNull();
    });

    it('lets a reader copy but not record without messages:write', async () => {
      renderCard({ canWrite: false });
      await generateDraft();
      expect(screen.getByRole('button', { name: /Copiar/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Registrar no histórico' })).toBeNull();
      expect(screen.queryByLabelText('Canal da mensagem')).toBeNull();
      expect(screen.getByText('Nenhuma mensagem registrada para esta OS.')).toBeTruthy();
    });

    it('hides the generator without messages:generate', async () => {
      renderCard({ canGenerate: false });
      await screen.findByText('Nenhuma mensagem registrada para esta OS.');
      expect(screen.queryByRole('button', { name: 'Gerar mensagem' })).toBeNull();
    });
  });
});
