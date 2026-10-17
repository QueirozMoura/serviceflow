import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { Signup, validateSignup } from './Signup';

const authMock = vi.hoisted(() => ({ signup: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authMock }));

const renderPage = () => render(<MemoryRouter initialEntries={['/signup']}><Routes><Route path="/signup" element={<Signup />} /><Route path="/dashboard" element={<p>painel</p>} /><Route path="/login" element={<p>entrar</p>} /></Routes></MemoryRouter>);
const fill = (values: Partial<Record<string, string>> = {}) => {
  const v = { company: 'Tech Fix', name: 'Maria Souza', email: 'maria@empresa.com', password: 'StrongPass1', confirm: 'StrongPass1', ...values };
  fireEvent.change(screen.getByLabelText('Nome da empresa'), { target: { value: v.company } });
  fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: v.name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: v.email } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: v.password } });
  fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: v.confirm } });
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Criar conta/ }));

describe('Signup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the fields locally and sends nothing when they are invalid', () => {
    renderPage();
    const cases: Array<[Partial<Record<string, string>>, RegExp]> = [
      [{ company: 'A' }, /nome da empresa/], [{ name: 'M' }, /seu nome/], [{ email: 'invalido' }, /email válido/],
      [{ password: 'curta1A', confirm: 'curta1A' }, /pelo menos 8 caracteres/], [{ password: 'todaminuscula1', confirm: 'todaminuscula1' }, /maiúscula/], [{ confirm: 'Different1' }, /não conferem/],
    ];
    for (const [values, message] of cases) { fill(values); submit(); expect(screen.getByRole('alert').textContent).toMatch(message); }
    expect(authMock.signup).not.toHaveBeenCalled();
  });

  it('mirrors the backend password rule in the pure validator', () => {
    const ok = { organizationName: 'Org', name: 'Ana', email: 'a@b.co', password: 'StrongPass1', confirm: 'StrongPass1' };
    expect(validateSignup(ok)).toBeNull();
    expect(validateSignup({ ...ok, password: 'strongpass1', confirm: 'strongpass1' })).not.toBeNull();
  });

  it('creates the account with trimmed data (no role, no organization id) and goes to the dashboard', async () => {
    authMock.signup.mockResolvedValue(undefined);
    renderPage();
    fill({ company: '  Tech Fix  ', name: ' Maria Souza ', email: ' maria@empresa.com ' });
    submit();
    expect(await screen.findByText('painel')).toBeTruthy();
    expect(authMock.signup).toHaveBeenCalledWith({ organizationName: 'Tech Fix', name: 'Maria Souza', email: 'maria@empresa.com', password: 'StrongPass1' });
  });

  it('explains each server refusal without exposing details, and blocks duplicate submissions while pending', async () => {
    renderPage();
    for (const [status, message] of [[409, /já tem conta/], [429, /Muitas tentativas/], [400, /Revise/], [500, /Tente novamente/]] as const) {
      authMock.signup.mockRejectedValueOnce(new ApiError('detalhe interno', status));
      fill(); submit();
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(message));
      expect(screen.getByRole('alert').textContent).not.toMatch(/detalhe interno/);
    }
    let release!: () => void;
    authMock.signup.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    fill();
    const form = screen.getByRole('button', { name: /Criar conta/ }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(authMock.signup).toHaveBeenCalledTimes(5);
    release();
    await screen.findByText('painel');
  });

  it('is reachable from the login page and says that the email is not confirmed yet', () => {
    renderPage();
    expect(screen.getByText(/não é confirmado por mensagem/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/login');
  });
});
