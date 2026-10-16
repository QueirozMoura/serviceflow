import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../services/api';

const loginMock = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ login: loginMock }) }));

import { Login } from './Login';

const renderLogin = (search = '') => render(<MemoryRouter initialEntries={[`/login${search}`]}><Routes><Route path="/login" element={<Login />} /><Route path="/dashboard" element={<div>Painel</div>} /></Routes></MemoryRouter>);

describe('Login', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows no error on a clean visit', () => {
    renderLogin();
    expect(screen.queryByText(/Google/, { selector: '.form-error' })).toBeNull();
  });

  it('shows the generic message when the Google flow fails', () => {
    renderLogin('?error=oauth');
    expect(screen.getByText('Não foi possível entrar com o Google. Tente novamente.')).toBeTruthy();
  });

  it('guides the user to the original method when the Google e-mail belongs to a local account, without confirming any account', () => {
    renderLogin('?error=oauth_unlinked');
    const message = screen.getByText(/entre pelo método que usou ao criá-la/);
    expect(message.textContent).toContain('Se você já tem uma conta');
    expect(message.textContent).not.toMatch(/já está cadastrad|existe uma conta|@/);
  });

  it('ignores unknown error reasons from the URL', () => {
    renderLogin('?error=<script>');
    expect(screen.queryByText(/Não foi possível entrar/)).toBeNull();
  });

  it('keeps the e-mail and password login working and reports invalid credentials', async () => {
    loginMock.mockResolvedValueOnce(undefined);
    renderLogin();
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'dono@example.com' } });
    fireEvent.change(screen.getByLabelText(/Senha/i), { target: { value: 'StrongPass1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Entrar/ }));
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({ email: 'dono@example.com', password: 'StrongPass1' }));
    expect(await screen.findByText('Painel')).toBeTruthy();

    loginMock.mockRejectedValueOnce(new ApiError('Invalid email or password', 401));
    renderLogin();
    fireEvent.change(screen.getAllByLabelText(/Email/i)[0]!, { target: { value: 'dono@example.com' } });
    fireEvent.change(screen.getAllByLabelText(/Senha/i)[0]!, { target: { value: 'errada' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^Entrar/ })[0]!);
    expect(await screen.findByText('Email ou senha inválidos.')).toBeTruthy();
  });
});
