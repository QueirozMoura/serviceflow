import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ErrorState, Loading } from './Feedback';

export { Loading, ErrorState };

/** Ilustração decorativa (sem significado próprio): uma bancada com ferramentas, desenhada com as cores do tema. */
export function EmptyArt() {
  return (
    <svg className="empty-art" viewBox="0 0 120 96" fill="none" aria-hidden="true" focusable="false">
      <rect x="10" y="60" width="100" height="8" rx="4" fill="var(--surface-sunken)" />
      <rect x="22" y="22" width="76" height="46" rx="10" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="2" />
      <rect x="32" y="34" width="34" height="6" rx="3" fill="var(--accent-200)" />
      <rect x="32" y="46" width="52" height="5" rx="2.5" fill="var(--line)" />
      <rect x="32" y="56" width="26" height="5" rx="2.5" fill="var(--line)" />
      <circle cx="90" cy="30" r="14" fill="var(--accent-600)" />
      <path d="M90 23v14M83 30h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="40" r="3" fill="var(--accent-200)" />
      <circle cx="108" cy="58" r="2.5" fill="var(--line-strong)" />
    </svg>
  );
}

export function EmptyState({ title, message, actionLabel, to }: { title: string; message: string; actionLabel: string; to: string }) {
  return <div className="resource-empty"><EmptyArt /><h2>{title}</h2><p>{message}</p><Link className="button button-primary button-small" to={to}><Plus size={15} aria-hidden="true" />{actionLabel}</Link></div>;
}
