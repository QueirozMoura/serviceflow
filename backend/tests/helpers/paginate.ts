import type { Page, PageQuery } from '../../src/modules/shared/pagination.js';

/** Paginacao em memoria para os repositorios falsos dos testes de rota (o banco real e coberto na integracao). */
export function paginate<T>(rows: T[], query: PageQuery): Page<T> {
  const start = (query.page - 1) * query.pageSize;
  return { items: rows.slice(start, start + query.pageSize), total: rows.length };
}

export const includesText = (term: string | undefined, ...values: Array<string | null | undefined>) =>
  !term || values.some((value) => (value ?? '').toLocaleLowerCase().includes(term.toLocaleLowerCase()));
