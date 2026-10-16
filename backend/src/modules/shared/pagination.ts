import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1_000_000;

// Parametros de query chegam como texto. Somente digitos decimais sao aceitos; qualquer outro valor (vazio, 0,
// negativo, decimal, notacao exponencial/hexadecimal, texto, espacos, repetido) falha a validacao e vira 400.
// Parametros desconhecidos sao descartados e nunca usados.
const positiveInteger = (max: number, fallback: number) =>
  z
    .string()
    .regex(/^\d{1,7}$/)
    .optional()
    .transform((value) => (value === undefined ? fallback : Number(value)))
    .pipe(z.number().int().min(1).max(max));

export const pageQueryShape = {
  page: positiveInteger(MAX_PAGE, 1),
  pageSize: positiveInteger(MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
};

/** Termo de busca opcional: sem espacos nas pontas, ate 100 caracteres; vazio equivale a "sem busca". */
export const searchTermSchema = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => (value ? value : undefined));

export type PageQuery = { page: number; pageSize: number };

export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export type Page<T> = { items: T[]; total: number };

export function skipTake({ page, pageSize }: PageQuery): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPagination({ page, pageSize }: PageQuery, total: number): Pagination {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Escapa os curingas do LIKE: o Prisma parametriza o valor (sem SQL dinamico), mas NAO escapa % e _, entao sem isto
 * buscar "%" ou "_" casaria com todos os registros. A barra invertida e o escape padrao do PostgreSQL.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/** Busca textual sem diferenciar maiusculas/minusculas, tratando % e _ como caracteres comuns. */
export function containsInsensitive(term: string) {
  return { contains: escapeLike(term), mode: 'insensitive' as const };
}

/** Formato de ordenacao estavel: o criterio principal mais o id como desempate unico. */
export const newestFirst = [{ createdAt: 'desc' as const }, { id: 'asc' as const }];
