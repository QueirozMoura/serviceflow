import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageInfo } from '../../types/pagination';

interface PaginationProps {
  pagination: PageInfo;
  /** Quantos registros a página atual está exibindo. */
  shown: number;
  /** [singular, plural] do tipo de registro, ex.: ['cliente', 'clientes']. */
  noun: [string, string];
  loading?: boolean;
  onPageChange: (page: number) => void;
}

export function Pagination({ pagination, shown, noun, loading = false, onPageChange }: PaginationProps) {
  const { page, pageSize, total, totalPages } = pagination;
  const first = total === 0 || shown === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = first === 0 ? 0 : first + shown - 1;
  const pages = Math.max(totalPages, 1);
  return <nav className="pagination" aria-label="Paginação">
    <span className="pagination-summary">{total === 0 ? `0 ${noun[1]}` : `Mostrando ${first}–${last} de ${total} ${total === 1 ? noun[0] : noun[1]}`}</span>
    <div className="pagination-controls">
      <button className="button button-secondary button-small" type="button" onClick={() => onPageChange(page - 1)} disabled={loading || page <= 1}><ChevronLeft size={15} aria-hidden="true" /> Anterior</button>
      <span className="pagination-page" aria-live="polite">Página {page} de {pages}</span>
      <button className="button button-secondary button-small" type="button" onClick={() => onPageChange(page + 1)} disabled={loading || page >= totalPages}>Próxima <ChevronRight size={15} aria-hidden="true" /></button>
    </div>
  </nav>;
}
