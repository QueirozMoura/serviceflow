import type { PageInfo } from '../types/pagination';

/** Fatia uma lista como o servidor faria: itens da página e metadados. */
export function pageOf<T>(all: T[], { page, pageSize }: { page: number; pageSize: number }): { items: T[]; pagination: PageInfo } {
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), pagination: { page, pageSize, total: all.length, totalPages: Math.ceil(all.length / pageSize) } };
}

export const pageInfo = (page: number, total: number, pageSize = 20): PageInfo => ({ page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
