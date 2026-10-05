import { useState, type FormEvent } from 'react';
import { ArrowRight, Mail, Wrench } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError, googleAuthUrl } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(searchParams.get('error') === 'oauth' ? 'Não foi possível entrar com o Google. Tente novamente.' : '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!email.trim() || !password) { setError('Informe seu email e sua senha para continuar.'); return; }
    setError(''); setIsSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      const from = location.state?.from?.pathname as string | undefined;
      navigate(from && from !== '/login' ? from : '/dashboard', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401 ? 'Email ou senha inválidos.' : 'Não foi possível entrar agora. Tente novamente.');
    } finally { setIsSubmitting(false); }
  };

  const handleGoogle = () => {
    // Navegacao tradicional: o backend inicia o fluxo OAuth e devolve a sessao HttpOnly.
    window.location.href = googleAuthUrl();
  };

  return <main className="auth-page"><div className="auth-panel"><div className="auth-brand"><div className="brand-mark"><Wrench size={21} /></div><span>Service<span>Flow</span></span></div><div className="auth-copy"><p className="eyebrow">Gestão de assistência técnica</p><h1>Trabalho organizado começa aqui.</h1><p>Acompanhe sua operação, sua equipe e cada atendimento em um só lugar.</p></div><form className="login-form" onSubmit={handleSubmit} noValidate><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoComplete="email" /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" autoComplete="current-password" /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<Button className="button-primary button-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Entrando...' : 'Entrar'}{!isSubmitting ? <ArrowRight size={17} /> : null}</Button></form><button type="button" className="button-google" onClick={handleGoogle}><GoogleIcon /> Continuar com Google</button><p className="auth-note"><Mail size={15} /> Acesso protegido por sessão segura</p></div><div className="auth-aside"><div className="aside-line" /><p>ServiceFlow</p><h2>Mais clareza para cada serviço.</h2><span>Uma visão precisa da operação para sua equipe atender melhor.</span></div></main>;
}

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.12A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.61H1.26a12 12 0 0 0 0 10.78l4.01-3.12Z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.61l4.01 3.12C6.22 6.88 8.87 4.77 12 4.77Z"/></svg>;
}
