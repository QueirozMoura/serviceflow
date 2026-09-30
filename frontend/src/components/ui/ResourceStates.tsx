import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ErrorState, Loading } from './Feedback';

export { Loading, ErrorState };
export function EmptyState({ title, message, actionLabel, to }: { title: string; message: string; actionLabel: string; to: string }) {
  return <div className="resource-empty"><div className="empty-plus"><Plus size={19} /></div><h3>{title}</h3><p>{message}</p><Link className="button button-primary button-small" to={to}>{actionLabel}</Link></div>;
}
export function ResourceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="resource-error"><ErrorState message={message} actionLabel="Tentar novamente" onAction={onRetry} /></div>;
}
