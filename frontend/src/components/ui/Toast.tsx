import { AlertCircle, CheckCircle2, X } from 'lucide-react';

/** `tone="error"` muda só o ícone e a cor de destaque; o aviso continua sendo anunciado como status. */
export function Toast({ message, onClose, tone = 'success' }: { message: string; onClose: () => void; tone?: 'success' | 'error' }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return <div className={`toast toast-${tone}`} role="status"><Icon size={18} aria-hidden="true" /><span>{message}</span><button type="button" aria-label="Fechar mensagem" onClick={onClose}><X size={15} /></button></div>;
}
