import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { ResetPassword } from './ResetPassword';

const token = 'R'.repeat(43);
const serviceMock = vi.hoisted(() => ({ validate: vi.fn(), reset: vi.fn() }));
vi.mock('../../services/passwordReset', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../services/passwordReset')>()), passwordResetService: serviceMock }));

const renderPage = () => render(<MemoryRouter initialEntries={['/reset-password']}><ResetPassword /></MemoryRouter>);
const fill = (password: string, confirm = password) => {
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }));
};

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', `/reset-password#t=${token}`);
    serviceMock.validate.mockResolvedValue({ valid: true });
  });

  it('validates the link, hides the token from the address bar and changes the password, without logging in', async () => {
    serviceMock.reset.mockResolvedValue({ message: 'ok' });
    renderPage();
    await screen.findByLabelText('Nova senha');
    expect(serviceMock.validate).toHaveBeenCalledWith(token);
    expect(window.location.hash).toBe('');

    fill('NewPassw0rd');
    expect((await screen.findByRole('status')).textContent).toMatch(/Senha alterada com sucesso/);
    expect(serviceMock.reset).toHaveBeenCalledWith(token, 'NewPassw0rd');
    expect(screen.getByRole('link', { name: 'Entrar com a nova senha' }).getAttribute('href')).toBe('/login');
  });

  it('validates the password locally and keeps the token unused', async () => {
    renderPage();
    await screen.findByLabelText('Nova senha');
    fill('fraca');
    expect(screen.getByRole('alert').textContent).toMatch(/pelo menos 8 caracteres/);
    fill('NewPassw0rd', 'Different1pass');
    expect(screen.getByRole('alert').textContent).toMatch(/não conferem/);
    expect(serviceMock.reset).not.toHaveBeenCalled();
  });

  it('shows a single message for a missing, expired, reused or tampered link and offers a new one', async () => {
    serviceMock.validate.mockRejectedValue(new ApiError('Reset link not found or no longer valid', 404));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/não é válido ou expirou/);
    expect(screen.getByRole('link', { name: 'Pedir um novo link' }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.queryByLabelText('Nova senha')).toBeNull();
  });

  it('treats a link without token as invalid without calling the server', async () => {
    window.history.replaceState(null, '', '/reset-password');
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/não é válido ou expirou/);
    expect(serviceMock.validate).not.toHaveBeenCalled();
  });

  it('turns an expired link at submit time into the invalid state, and explains reuse of another account\'s password', async () => {
    serviceMock.reset.mockRejectedValueOnce(new ApiError('Choose a different password', 409)).mockRejectedValueOnce(new ApiError('Reset link not found or no longer valid', 404));
    renderPage();
    await screen.findByLabelText('Nova senha');
    fill('NewPassw0rd');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/outra conta com este email/));
    fill('NewPassw0rd');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/não é válido ou expirou/));
  });
});
