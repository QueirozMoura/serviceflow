import { useState, type FormEvent } from 'react';
import { ArrowRight, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { passwordResetService } from '../../services/passwordReset';
import { Button } from '../../components/ui/Button';

function requestError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 400) return 'Informe um email válido.';
  if (cause instanceof ApiError && cause.status === 429) return 'Muitas tentativas. Aguarde um minuto e tente novamente.';
  return 'Não foi possível enviar o pedido agora. Tente novamente.';
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Informe um email válido.'); return; }
    setError(''); setSubmitting(true);
    try { await passwordResetService.request(email.trim()); setSent(true); }
    catch (cause) { setError(requestError(cause)); }
    finally { setSubmitting(false); }
  };

  const body = sent
    // Mensagem única, igual para qualquer e-mail: nunca confirma nem nega a existência da conta.
    ? <div className="login-form" role="status"><p>Se existir uma conta com este email, enviamos as instruções para criar uma nova senha. O link vale por 30 minutos e só pode ser usado uma vez.</p><p>Não chegou? Confira a caixa de spam ou aguarde um minuto e peça novamente.</p></div>
    : <form className="login-form" onSubmit={(event) => void submit(event)} noValidate>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoComplete="email" /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button className="button-primary button-submit" type="submit" disabled={submitting}>{submitting ? 'Enviando...' : 'Enviar instruções'}{!submitting ? <ArrowRight size={17} /> : null}</Button>
    </form>;

  return <main className="auth-page"><div className="auth-panel"><div className="auth-brand"><div className="brand-mark"><Wrench size={21} /></div><span>Service<span>Flow</span></span></div><div className="auth-copy"><p className="eyebrow">Recuperar acesso</p><h1>Esqueceu a senha?</h1><p>Informe o email da sua conta e enviaremos um link para criar uma nova senha.</p></div>{body}<p className="auth-note"><Link to="/login">Voltar para o login</Link></p></div><div className="auth-aside"><div className="aside-line" /><p>ServiceFlow</p><h2>Mais clareza para cada serviço.</h2><span>Uma visão precisa da operação para sua equipe atender melhor.</span></div></main>;
}
