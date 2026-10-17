import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { ForgotPassword } from './ForgotPassword';

const serviceMock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/passwordReset', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../services/passwordReset')>()), passwordResetService: serviceMock }));

const renderPage = () => render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
const submit = (email: string) => { fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } }); fireEvent.click(screen.getByRole('button', { name: /Enviar instruções/ })); };

describe('ForgotPassword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the email locally and sends nothing when it is invalid', () => {
    renderPage();
    submit('invalido');
    expect(screen.getByRole('alert').textContent).toMatch(/email válido/);
    expect(serviceMock.request).not.toHaveBeenCalled();
  });

  it('shows the same neutral confirmation after any successful request, never saying whether the account exists', async () => {
    serviceMock.request.mockResolvedValue({ message: 'x' });
    renderPage();
    submit(' ana@empresa.com ');
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(serviceMock.request).toHaveBeenCalledWith('ana@empresa.com');
    expect(screen.getByRole('status').textContent).toMatch(/Se existir uma conta com este email/);
    expect(screen.getByRole('status').textContent).toMatch(/30 minutos/);
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('explains rate limiting and generic failures without exposing details', async () => {
    renderPage();
    for (const [status, message] of [[429, /Muitas tentativas/], [400, /email válido/], [500, /Tente novamente/]] as const) {
      serviceMock.request.mockRejectedValueOnce(new ApiError('detalhe interno', status));
      submit('ana@empresa.com');
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(message));
      expect(screen.getByRole('alert').textContent).not.toMatch(/detalhe interno/);
    }
  });

  it('blocks duplicate submissions while a request is pending', async () => {
    let release!: () => void;
    serviceMock.request.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@empresa.com' } });
    const form = screen.getByRole('button', { name: /Enviar instruções/ }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(serviceMock.request).toHaveBeenCalledTimes(1);
    release();
    await screen.findByRole('status');
  });

  it('links back to the login page', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Voltar para o login' }).getAttribute('href')).toBe('/login');
  });
});
