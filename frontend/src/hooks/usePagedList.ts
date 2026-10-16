import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { PageInfo } from '../types/pagination';

export const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

export interface PagedResult<T, S = undefined> { items: T[]; pagination: PageInfo; summary?: S; }

interface Options<T, S, F extends Record<string, string>> {
  fetchPage: (params: { page: number; pageSize: number; q: string; filters: F }) => Promise<PagedResult<T, S>>;
  initialFilters: F;
}

// Busca confirmada, filtros e página vivem no mesmo estado: qualquer mudança de critério zera a página no mesmo passo
// (sem requisição intermediária) e voltar a um critério anterior nunca "ressuscita" uma página antiga.
interface Criteria<F> { committedSearch: string; filters: F; page: number; }
type Action<F> =
  | { type: 'commitSearch'; value: string }
  | { type: 'setFilter'; name: keyof F; value: string }
  | { type: 'clear'; filters: F }
  | { type: 'setPage'; page: number };

function reduce<F extends Record<string, string>>(state: Criteria<F>, action: Action<F>): Criteria<F> {
  switch (action.type) {
    case 'commitSearch': return action.value === state.committedSearch ? state : { ...state, committedSearch: action.value, page: 1 };
    case 'setFilter': return state.filters[action.name] === action.value ? state : { ...state, filters: { ...state.filters, [action.name]: action.value }, page: 1 };
    case 'clear': return state.committedSearch === '' && state.filters === action.filters && state.page === 1 ? state : { committedSearch: '', filters: action.filters, page: 1 };
    case 'setPage': return action.page === state.page ? state : { ...state, page: action.page };
  }
}

/**
 * Lista paginada pelo servidor com busca e filtros. Regras:
 * - a busca só é enviada depois de uma pausa na digitação;
 * - mudar a busca ou qualquer filtro volta para a primeira página;
 * - respostas de requisições antigas são descartadas;
 * - se a página atual ficar vazia (ex.: último item excluído), vai para a última página existente.
 */
export function usePagedList<T, S = undefined, F extends Record<string, string> = Record<string, string>>({ fetchPage, initialFilters }: Options<T, S, F>) {
  const [initial] = useState(initialFilters);
  const [search, setSearch] = useState('');
  const [criteria, dispatch] = useReducer(reduce<F>, { committedSearch: '', filters: initialFilters, page: 1 });
  const [data, setData] = useState<PagedResult<T, S> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const fetchRef = useRef(fetchPage);
  const sequence = useRef(0);

  useEffect(() => { fetchRef.current = fetchPage; });
  useEffect(() => () => { sequence.current += 1; }, []);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === criteria.committedSearch) return;
    const timer = setTimeout(() => dispatch({ type: 'commitSearch', value: trimmed }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, criteria.committedSearch]);

  const { page, committedSearch, filters } = criteria;
  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const result = await fetchRef.current({ page, pageSize: PAGE_SIZE, q: committedSearch, filters });
      if (requestId !== sequence.current) return;
      if (result.items.length === 0 && result.pagination.total > 0 && page > 1) {
        dispatch({ type: 'setPage', page: Math.max(1, result.pagination.totalPages) });
        return;
      }
      setData(result);
    } catch (cause) {
      if (requestId !== sequence.current) return;
      setError(cause);
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [page, committedSearch, filters]);

  useEffect(() => { void load(); }, [load, reloadToken]);

  const setPage = useCallback((next: number) => dispatch({ type: 'setPage', page: next }), []);
  const setFilter = useCallback(<K extends keyof F>(name: K, value: F[K]) => dispatch({ type: 'setFilter', name, value }), []);
  const clearFilters = useCallback(() => { setSearch(''); dispatch({ type: 'clear', filters: initial }); }, [initial]);
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const hasActiveFilters = search.trim() !== '' || (Object.keys(initial) as Array<keyof F>).some((name) => filters[name] !== initial[name]);

  return { items: data?.items ?? [], pagination: data?.pagination ?? null, summary: data?.summary, loading, error, page, setPage, search, setSearch, filters, setFilter, clearFilters, hasActiveFilters, reload };
}
