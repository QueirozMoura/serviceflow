import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError } from '../../services/api';
import { teamService, tokenFromHash } from '../../services/team';
import type { InvitationPreview } from '../../types/team';
import { Button } from '../../components/ui/Button';
import { Loading } from '../../components/ui/Feedback';

const roleLabels: Record<string, string> = { ADMIN: 'Administrador', TECHNICIAN: 'Técnico' };

function acceptError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 404) return 'Este convite não é mais válido. Peça um novo link ao proprietário da conta.';
  if (cause instanceof ApiError && cause.status === 409 && cause.message === 'Choose a different password') return 'Você já usa esta senha em outra conta com este email. Escolha uma senha diferente para esta equipe.';
  if (cause instanceof ApiError && cause.status === 409) return 'Não foi possível aceitar este convite.';
  if (cause instanceof ApiError && cause.status === 400) return 'Revise seu nome e a senha (mínimo de 8 caracteres, com maiúscula, minúscula e número).';
  if (cause instanceof ApiError && cause.status === 429) return 'Muitas tentativas. Aguarde um minuto e tente novamente.';
  return 'Não foi possível aceitar o convite agora. Tente novamente.';
}

export function AcceptInvite() {
  const { isAuthenticated, isLoading, acceptInvitation, logout } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(() => tokenFromHash(window.location.hash));
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>(token ? 'loading' : 'invalid');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // O token fica só em memória: sai da barra de endereços para não ser compartilhado sem querer.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (!token || isLoading || isAuthenticated) return;
    let active = true;
    teamService.inspectInvitation(token).then((response) => { if (active) { setInvitation(response.invitation); setState('ready'); } }).catch(() => { if (active) setState('invalid'); });
    return () => { active = false; };
  }, [token, isLoading, isAuthenticated]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !token) return;
    if (name.trim().length < 2) { setError('Informe seu nome (mínimo de 2 caracteres).'); return; }
    if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) { setError('A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.'); return; }
    setError(''); setSubmitting(true);
    try { await acceptInvitation({ token, name: name.trim(), password }); navigate('/dashboard', { replace: true }); }
    catch (cause) { setError(acceptError(cause)); if (cause instanceof ApiError && cause.status === 404) setState('invalid'); }
    finally { setSubmitting(false); }
  };

  const body = isLoading ? <Loading message="Verificando sua sessão..." />
    : isAuthenticated ? <div className="login-form"><p>Você já está conectado a uma conta. Saia dela para aceitar este convite.</p><Button className="button-secondary" type="button" onClick={() => void logout()}>Sair da conta atual</Button></div>
    : state === 'loading' ? <Loading message="Verificando o convite..." />
    : state === 'invalid' ? <p className="form-error" role="alert">Este convite não é válido ou expirou. Peça um novo link ao proprietário da conta.</p>
    : <form className="login-form" onSubmit={(event) => void submit(event)} noValidate>
      <p>Você foi convidado para <strong>{invitation?.organizationName}</strong> como <strong>{roleLabels[invitation?.role ?? ''] ?? invitation?.role}</strong>.</p>
      <label>Email<input type="email" value={invitation?.email ?? ''} readOnly aria-readonly="true" /></label>
      <label>Seu nome<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome completo" autoComplete="name" /></label>
      <label>Crie uma senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" autoComplete="new-password" /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button className="button-primary button-submit" type="submit" disabled={submitting}>{submitting ? 'Entrando...' : 'Aceitar convite'}{!submitting ? <ArrowRight size={17} /> : null}</Button>
    </form>;

  return <main className="auth-page"><div className="auth-panel"><div className="auth-brand"><div className="brand-mark"><Wrench size={21} /></div><span>Service<span>Flow</span></span></div><div className="auth-copy"><p className="eyebrow">Convite</p><h1>Entre para a equipe.</h1></div>{body}</div><div className="auth-aside"><div className="aside-line" /><p>ServiceFlow</p><h2>Mais clareza para cada serviço.</h2><span>Uma visão precisa da operação para sua equipe atender melhor.</span></div></main>;
}
