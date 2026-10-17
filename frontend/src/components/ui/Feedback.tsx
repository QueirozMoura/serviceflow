import { AlertCircle } from 'lucide-react';

interface FeedbackProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Loading({ message = 'Carregando...' }: { message?: string }) {
  return (
    <div className="feedback feedback-skeleton" role="status">
      <span className="feedback-caption">{message}</span>
      <span className="skeleton" aria-hidden="true" />
      <span className="skeleton" aria-hidden="true" />
      <span className="skeleton" aria-hidden="true" />
    </div>
  );
}

export function ErrorState({ message, actionLabel, onAction }: FeedbackProps) {
  return (
    <div className="feedback feedback-error" role="alert">
      <AlertCircle size={20} aria-hidden="true" />
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button className="button button-secondary button-small" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
