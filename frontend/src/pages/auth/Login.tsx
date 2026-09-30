import { useState, type FormEvent } from 'react';
import { ArrowRight, Mail, Wrench } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { useLocation, useNavigate } from 'react-router-dom';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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

  return <main className="auth-page"><div className="auth-panel"><div className="auth-brand"><div className="brand-mark"><Wrench size={21} /></div><span>Service<span>Flow</span></span></div><div className="auth-copy"><p className="eyebrow">Gestão de assistência técnica</p><h1>Trabalho organizado começa aqui.</h1><p>Acompanhe sua operação, sua equipe e cada atendimento em um só lugar.</p></div><form className="login-form" onSubmit={handleSubmit} noValidate><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoComplete="email" /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" autoComplete="current-password" /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<Button className="button-primary button-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Entrando...' : 'Entrar'}{!isSubmitting ? <ArrowRight size={17} /> : null}</Button></form><p className="auth-note"><Mail size={15} /> Acesso protegido por sessão segura</p></div><div className="auth-aside"><div className="aside-line" /><p>ServiceFlow</p><h2>Mais clareza para cada serviço.</h2><span>Uma visão precisa da operação para sua equipe atender melhor.</span></div></main>;
}
