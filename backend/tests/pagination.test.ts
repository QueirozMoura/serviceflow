import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildPagination, containsInsensitive, DEFAULT_PAGE_SIZE, escapeLike, MAX_PAGE_SIZE, pageQueryShape, searchTermSchema, skipTake } from '../src/modules/shared/pagination.js';

const schema = z.object({ ...pageQueryShape, q: searchTermSchema });

describe('pagination query validation', () => {
  it('applies defaults when nothing is sent', () => {
    expect(schema.parse({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, q: undefined });
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it('coerces numeric text and accepts the documented limits', () => {
    expect(schema.parse({ page: '3', pageSize: '100' })).toMatchObject({ page: 3, pageSize: 100 });
    expect(schema.parse({ page: '1', pageSize: '1' })).toMatchObject({ page: 1, pageSize: 1 });
  });

  it.each([
    ['page zero', { page: '0' }],
    ['negative page', { page: '-1' }],
    ['decimal page', { page: '1.5' }],
    ['text page', { page: 'abc' }],
    ['empty page', { page: '' }],
    ['huge page', { page: '99999999999' }],
    ['repeated page', { page: ['1', '2'] }],
    ['pageSize zero', { pageSize: '0' }],
    ['pageSize above the maximum', { pageSize: '101' }],
    ['negative pageSize', { pageSize: '-5' }],
    ['decimal pageSize', { pageSize: '10.5' }],
    ['text pageSize', { pageSize: 'all' }],
    ['empty pageSize', { pageSize: '' }],
    ['exponent pageSize', { pageSize: '1e2' }],
    ['hex pageSize', { pageSize: '0x10' }],
    ['signed page', { page: '+2' }],
    ['padded page', { page: ' 2 ' }],
    ['leading-zero overflow', { page: '00000001' }],
    ['non-ASCII digits', { page: '٢' }],
    ['repeated q', { q: ['a', 'b'] }],
    ['q above 100 characters', { q: 'x'.repeat(101) }],
  ])('rejects %s', (_label, query) => {
    expect(schema.safeParse(query).success).toBe(false);
  });

  it('trims the search term and treats an empty one as no search', () => {
    expect(schema.parse({ q: '  dell  ' }).q).toBe('dell');
    expect(schema.parse({ q: '   ' }).q).toBeUndefined();
    expect(schema.parse({ q: '' }).q).toBeUndefined();
    expect(schema.parse({ q: 'x'.repeat(100) }).q).toHaveLength(100);
  });

  it('drops unknown parameters instead of forwarding them', () => {
    const parsed = schema.parse({ page: '1', organizationId: 'org-b', orderBy: 'name', sort: 'desc', skip: '500', take: '9999' });
    for (const forbidden of ['organizationId', 'orderBy', 'sort', 'skip', 'take']) expect(parsed).not.toHaveProperty(forbidden);
    expect(parsed).toMatchObject({ page: 1, pageSize: 20 });
  });
});

describe('pagination arithmetic', () => {
  it('computes skip and take from page and size', () => {
    expect(skipTake({ page: 1, pageSize: 20 })).toEqual({ skip: 0, take: 20 });
    expect(skipTake({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
    expect(skipTake({ page: 2, pageSize: 100 })).toEqual({ skip: 100, take: 100 });
  });

  it('builds metadata, including empty results and pages past the end', () => {
    expect(buildPagination({ page: 1, pageSize: 20 }, 45)).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
    expect(buildPagination({ page: 1, pageSize: 20 }, 40)).toEqual({ page: 1, pageSize: 20, total: 40, totalPages: 2 });
    expect(buildPagination({ page: 1, pageSize: 20 }, 0)).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    expect(buildPagination({ page: 9, pageSize: 20 }, 45)).toEqual({ page: 9, pageSize: 20, total: 45, totalPages: 3 });
    expect(buildPagination({ page: 1, pageSize: 100 }, 101).totalPages).toBe(2);
  });
});

describe('literal text search', () => {
  it('escapes LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
    expect(escapeLike('Cliente 01')).toBe('Cliente 01');
  });

  it('builds a case-insensitive contains filter with the escaped term', () => {
    expect(containsInsensitive('50%')).toEqual({ contains: '50\\%', mode: 'insensitive' });
  });
});
