import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  isOpen: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, isOpen, isLoading = false, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen || isLoading) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);
  if (!isOpen) return null;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="dialog-close" type="button" aria-label="Fechar" onClick={onCancel}><X size={18} /></button>
      <div className="dialog-icon"><AlertTriangle size={21} /></div>
      <h2 id="dialog-title">{title}</h2><p>{message}</p>
      <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onCancel} disabled={isLoading}>Cancelar</button><button className="button button-danger" type="button" onClick={onConfirm} disabled={isLoading}>{isLoading ? 'Excluindo...' : 'Excluir'}</button></div>
    </section>
  </div>;
}
