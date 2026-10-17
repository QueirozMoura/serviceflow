import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { AcceptInvite } from './AcceptInvite';

const token = 'T'.repeat(43);
const authMock = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false, acceptInvitation: vi.fn(), logout: vi.fn() }));
const teamMock = vi.hoisted(() => ({ inspectInvitation: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authMock }));
vi.mock('../../services/team', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../services/team')>()), teamService: teamMock }));

const renderPage = () => render(<MemoryRouter initialEntries={['/invite']}><Routes><Route path="/invite" element={<AcceptInvite />} /><Route path="/dashboard" element={<p>painel</p>} /></Routes></MemoryRouter>);
const preview = { invitation: { organizationName: 'Tech Fix', email: 'novo@empresa.com', role: 'TECHNICIAN' } };

describe('AcceptInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks(); authMock.isAuthenticated = false; authMock.isLoading = false;
    window.history.replaceState(null, '', `/invite#t=${token}`);
  });

  it('shows who invites, for which role and email, removes the token from the address bar, and sends only name and password', async () => {
    teamMock.inspectInvitation.mockResolvedValue(preview);
    authMock.acceptInvitation.mockResolvedValue(undefined);
    renderPage();

    expect(await screen.findByText('Tech Fix')).toBeTruthy();
    expect(screen.getByText('Técnico')).toBeTruthy();
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(true);
    expect(teamMock.inspectInvitation).toHaveBeenCalledWith(token);
    expect(window.location.hash).toBe('');

    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: ' Joana ' } });
    fireEvent.change(screen.getByLabelText('Crie uma senha'), { target: { value: 'StrongPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar convite' }));
    expect(await screen.findByText('painel')).toBeTruthy();
    expect(authMock.acceptInvitation).toHaveBeenCalledWith({ token, name: 'Joana', password: 'StrongPass1' });
  });

  it('validates name and password locally', async () => {
    teamMock.inspectInvitation.mockResolvedValue(preview);
    renderPage();
    await screen.findByText('Tech Fix');
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar convite' }));
    expect(screen.getByRole('alert').textContent).toMatch(/seu nome/);
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Joana' } });
    fireEvent.change(screen.getByLabelText('Crie uma senha'), { target: { value: 'fraca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar convite' }));
    expect(screen.getByRole('alert').textContent).toMatch(/pelo menos 8 caracteres/);
    expect(authMock.acceptInvitation).not.toHaveBeenCalled();
  });

  it('shows one generic message for a missing, expired, revoked or used invitation', async () => {
    teamMock.inspectInvitation.mockRejectedValue(new ApiError('Invitation not found or no longer valid', 404));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/não é válido ou expirou/);
    expect(screen.queryByRole('button', { name: 'Aceitar convite' })).toBeNull();
  });

  it('shows the same message when the link has no token at all, without calling the server', async () => {
    window.history.replaceState(null, '', '/invite');
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/não é válido ou expirou/);
    expect(teamMock.inspectInvitation).not.toHaveBeenCalled();
  });

  it('asks for another password when the one chosen is already used by an account with the same email, and reports expiry on accept', async () => {
    teamMock.inspectInvitation.mockResolvedValue(preview);
    authMock.acceptInvitation.mockRejectedValueOnce(new ApiError('Choose a different password', 409)).mockRejectedValueOnce(new ApiError('Invitation not found or no longer valid', 404));
    renderPage();
    await screen.findByText('Tech Fix');
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Joana' } });
    fireEvent.change(screen.getByLabelText('Crie uma senha'), { target: { value: 'StrongPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar convite' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/senha diferente/));
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar convite' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/não é válido ou expirou/));
  });

  it('does not accept on top of an active session: asks the user to sign out first and never inspects the token', async () => {
    authMock.isAuthenticated = true;
    renderPage();
    expect(await screen.findByText(/Você já está conectado/)).toBeTruthy();
    expect(teamMock.inspectInvitation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sair da conta atual' }));
    expect(authMock.logout).toHaveBeenCalled();
  });
});
