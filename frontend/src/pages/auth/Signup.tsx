import { useState, type FormEvent } from 'react';
import { ArrowRight, Wrench } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError } from '../../services/api';
import { Button } from '../../components/ui/Button';

/** Espelha as regras do backend (a validação real é a do servidor). */
export function validateSignup(input: { organizationName: string; name: string; email: string; password: string; confirm: string }): string | null {
  if (input.organizationName.trim().length < 2) return 'Informe o nome da empresa (mínimo de 2 caracteres).';
  if (input.name.trim().length < 2) return 'Informe seu nome (mínimo de 2 caracteres).';
  if (!/^\S+@\S+\.\S+$/.test(input.email.trim())) return 'Informe um email válido.';
  if (input.password.length < 8 || !/[a-z]/.test(input.password) || !/[A-Z]/.test(input.password) || !/[0-9]/.test(input.password)) return 'A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.';
  if (input.password !== input.confirm) return 'As senhas não conferem.';
  return null;
}

function signupError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 400) return 'Revise os campos informados.';
  if (cause instanceof ApiError && cause.status === 409) return 'Não foi possível criar a conta com estes dados. Se você já tem conta, entre por ela.';
  if (cause instanceof ApiError && cause.status === 429) return 'Muitas tentativas. Aguarde um minuto e tente novamente.';
  return 'Não foi possível criar a conta agora. Tente novamente.';
}

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ organizationName: '', name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const invalid = validateSignup(form);
    if (invalid) { setError(invalid); return; }
    setError(''); setSubmitting(true);
    try {
      await signup({ organizationName: form.organizationName.trim(), name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/dashboard', { replace: true });
    } catch (cause) { setError(signupError(cause)); } finally { setSubmitting(false); }
  };

  return <main className="auth-page"><div className="auth-panel"><div className="auth-brand"><div className="brand-mark"><Wrench size={21} /></div><span>Service<span>Flow</span></span></div><div className="auth-copy"><p className="eyebrow">Crie sua conta</p><h1>Comece a organizar sua assistência.</h1><p>Você será o proprietário da conta e poderá convidar sua equipe depois.</p></div><form className="login-form" onSubmit={(event) => void submit(event)} noValidate>
    <label>Nome da empresa<input value={form.organizationName} onChange={set('organizationName')} placeholder="Minha Assistência Técnica" autoComplete="organization" /></label>
    <label>Seu nome<input value={form.name} onChange={set('name')} placeholder="Seu nome completo" autoComplete="name" /></label>
    <label>Email<input type="email" value={form.email} onChange={set('email')} placeholder="voce@empresa.com" autoComplete="email" /></label>
    <label>Senha<input type="password" value={form.password} onChange={set('password')} placeholder="Mínimo de 8 caracteres" autoComplete="new-password" /></label>
    <label>Confirmar senha<input type="password" value={form.confirm} onChange={set('confirm')} placeholder="Repita a senha" autoComplete="new-password" /></label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <Button className="button-primary button-submit" type="submit" disabled={submitting}>{submitting ? 'Criando conta...' : 'Criar conta'}{!submitting ? <ArrowRight size={17} /> : null}</Button>
  </form><p className="auth-note">Por enquanto o email informado não é confirmado por mensagem.</p><p className="auth-note">Já tem conta? <Link to="/login">Entrar</Link></p></div><div className="auth-aside"><div className="aside-line" /><p>ServiceFlow</p><h2>Mais clareza para cada serviço.</h2><span>Uma visão precisa da operação para sua equipe atender melhor.</span></div></main>;
}
