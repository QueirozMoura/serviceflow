import { useEffect, useState, type FormEvent } from 'react';
import { BrandMark } from '../../components/ui/BrandMark';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { passwordResetService, resetTokenFromHash } from '../../services/passwordReset';
import { Button } from '../../components/ui/Button';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Loading } from '../../components/ui/Feedback';

function resetError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) return 'Você já usa esta senha em outra conta com este email. Escolha uma senha diferente.';
  if (cause instanceof ApiError && cause.status === 400) return 'A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.';
  if (cause instanceof ApiError && cause.status === 429) return 'Muitas tentativas. Aguarde um minuto e tente novamente.';
  return 'Não foi possível redefinir a senha agora. Tente novamente.';
}

export function ResetPassword() {
  const [token] = useState(() => resetTokenFromHash(window.location.hash));
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'done'>(token ? 'loading' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // O token fica só em memória: sai da barra de endereços para não ser compartilhado sem querer.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (!token) return;
    let active = true;
    passwordResetService.validate(token).then(() => { if (active) setState('ready'); }).catch(() => { if (active) setState('invalid'); });
    return () => { active = false; };
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !token) return;
    if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) { setError('A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.'); return; }
    if (password !== confirm) { setError('As senhas não conferem.'); return; }
    setError(''); setSubmitting(true);
    try { await passwordResetService.reset(token, password); setState('done'); }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setState('invalid'); else setError(resetError(cause));
    } finally { setSubmitting(false); }
  };

  const body = state === 'loading' ? <Loading message="Verificando o link..." />
    : state === 'invalid' ? <div className="login-form"><p className="form-error" role="alert">Este link não é válido ou expirou.</p><Link className="button button-primary" to="/forgot-password">Pedir um novo link</Link></div>
    : state === 'done' ? <div className="login-form" role="status"><p>Senha alterada com sucesso. Por segurança, as sessões abertas desta conta foram encerradas.</p><Link className="button button-primary" to="/login">Entrar com a nova senha</Link></div>
    : <form className="login-form" onSubmit={(event) => void submit(event)} noValidate>
      <label>Nova senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" autoComplete="new-password" /></label>
      <label>Confirmar nova senha<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Repita a senha" autoComplete="new-password" /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button className="button-primary button-submit" type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Redefinir senha'}{!submitting ? <ArrowRight size={17} /> : null}</Button>
    </form>;

  return <main className="auth-page"><ThemeToggle className="theme-toggle-floating" /><div className="auth-panel"><div className="auth-brand"><BrandMark /><span>Service<span>Flow</span></span></div><div className="auth-copy"><p className="eyebrow">Recuperar acesso</p><h1>Crie uma nova senha.</h1></div>{body}</div><div className="auth-aside"><div className="aside-line" /><p>ServiceFlow</p><h2>Mais clareza para cada serviço.</h2><span>Uma visão precisa da operação para sua equipe atender melhor.</span></div></main>;
}
