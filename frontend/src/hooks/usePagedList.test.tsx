import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePagedList, PAGE_SIZE, type PagedResult } from './usePagedList';
import { pageOf } from '../test/paging';

type Row = { id: number; name: string };
const rows: Row[] = Array.from({ length: 45 }, (_, index) => ({ id: index + 1, name: `Item ${String(index + 1).padStart(2, '0')}` }));
const fetchPage = vi.fn();
const serve = (all: Row[] = rows) => fetchPage.mockImplementation(async ({ page, pageSize, q, filters }: { page: number; pageSize: number; q: string; filters: { kind: string } }) => {
  const matches = all.filter((row) => (!q || row.name.toLowerCase().includes(q.toLowerCase())) && (!filters.kind || (filters.kind === 'even' ? row.id % 2 === 0 : row.id % 2 === 1)));
  return pageOf(matches, { page, pageSize }) as PagedResult<Row>;
});
const setup = () => renderHook(() => usePagedList<Row, undefined, { kind: string }>({ fetchPage: (params) => fetchPage(params), initialFilters: { kind: '' } }));
const lastCall = () => fetchPage.mock.calls.at(-1)?.[0];

describe('usePagedList', () => {
  beforeEach(() => { vi.clearAllMocks(); serve(); });

  it('loads the first page on mount with the fixed page size', async () => {
    const { result } = setup();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(PAGE_SIZE).toBe(20);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', filters: { kind: '' } });
    expect(result.current.items).toHaveLength(20);
    expect(result.current.pagination).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('changes page on the server', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPage(3));
    await waitFor(() => expect(result.current.items[0]?.name).toBe('Item 41'));
    expect(lastCall()).toMatchObject({ page: 3 });
    expect(result.current.items).toHaveLength(5);
    expect(result.current.page).toBe(3);
  });

  it('debounces the search, then queries once from the first page', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = fetchPage.mock.calls.length;

    act(() => result.current.setSearch('i'));
    act(() => result.current.setSearch('it'));
    act(() => result.current.setSearch('  item 3  '));
    expect(fetchPage.mock.calls.length).toBe(calls);
    expect(result.current.hasActiveFilters).toBe(true);

    await waitFor(() => expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: 'item 3', filters: { kind: '' } }), { timeout: 2000 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage.mock.calls.length).toBe(calls + 1);
    expect(result.current.page).toBe(1);
    expect(result.current.pagination?.total).toBe(10);
  });

  it('resets to the first page when a filter changes, without an intermediate request for the old page', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.items[0]?.name).toBe('Item 21'));
    const calls = fetchPage.mock.calls.length;

    act(() => result.current.setFilter('kind', 'even'));
    await waitFor(() => expect(result.current.pagination?.total).toBe(22));
    expect(fetchPage.mock.calls.length).toBe(calls + 1);
    expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', filters: { kind: 'even' } });
    expect(result.current.page).toBe(1);
  });

  it('does not refetch when a filter is set to the value it already has', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = fetchPage.mock.calls.length;

    act(() => result.current.setFilter('kind', ''));
    await act(async () => { await Promise.resolve(); });
    expect(fetchPage.mock.calls.length).toBe(calls);
  });

  it('clears the search and the filters immediately, back to the first page', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFilter('kind', 'odd'));
    act(() => result.current.setSearch('item 1'));
    await waitFor(() => expect(lastCall()).toMatchObject({ q: 'item 1', filters: { kind: 'odd' } }), { timeout: 2000 });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.clearFilters());
    await waitFor(() => expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', filters: { kind: '' } }));
    await waitFor(() => expect(result.current.pagination?.total).toBe(45));
    expect(result.current.search).toBe('');
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('ignores a slow response that arrives after a newer one', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolveSlow: (value: PagedResult<Row>) => void = () => undefined;
    fetchPage.mockReturnValueOnce(new Promise((resolve) => { resolveSlow = resolve; }));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.loading).toBe(true));
    act(() => result.current.setPage(3));
    await waitFor(() => expect(result.current.items[0]?.name).toBe('Item 41'));

    await act(async () => { resolveSlow(pageOf(rows, { page: 2, pageSize: 20 }) as PagedResult<Row>); });
    expect(result.current.items[0]?.name).toBe('Item 41');
    expect(result.current.pagination?.page).toBe(3);
  });

  it('exposes the error and reloads on demand', async () => {
    fetchPage.mockRejectedValueOnce(new Error('boom'));
    const { result } = setup();
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.loading).toBe(false);

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBeNull());
    await waitFor(() => expect(result.current.items).toHaveLength(20));
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('moves to the last existing page when the current one becomes empty', async () => {
    const all = rows.slice(0, 21);
    serve(all);
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.items.map((row) => row.id)).toEqual([21]));

    serve(all.slice(0, 20));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.page).toBe(1));
    await waitFor(() => expect(result.current.items).toHaveLength(20));
    expect(result.current.pagination).toEqual({ page: 1, pageSize: 20, total: 20, totalPages: 1 });
  });

  it('does not bounce between pages when the whole list is empty', async () => {
    serve([]);
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that arrives after unmounting', async () => {
    let resolveLate: (value: PagedResult<Row>) => void = () => undefined;
    fetchPage.mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve; }));
    const { result, unmount } = setup();
    expect(result.current.loading).toBe(true);
    unmount();
    await act(async () => { resolveLate(pageOf(rows, { page: 1, pageSize: 20 }) as PagedResult<Row>); });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('never resurrects an old page when the criteria return to a previous value (search then clear, filter then undo)', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.items[0]?.name).toBe('Item 21'));

    act(() => result.current.setSearch('item 3'));
    await waitFor(() => expect(lastCall()).toMatchObject({ page: 1, q: 'item 3' }), { timeout: 2000 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.clearFilters());
    await waitFor(() => expect(result.current.pagination?.total).toBe(45));
    expect(lastCall()).toEqual({ page: 1, pageSize: 20, q: '', filters: { kind: '' } });
    expect(result.current.page).toBe(1);
    expect(result.current.items[0]?.name).toBe('Item 01');

    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.items[0]?.name).toBe('Item 21'));
    act(() => result.current.setFilter('kind', 'even'));
    await waitFor(() => expect(result.current.pagination?.total).toBe(22));
    act(() => result.current.setFilter('kind', ''));
    await waitFor(() => expect(result.current.pagination?.total).toBe(45));
    expect(result.current.page).toBe(1);
    expect(result.current.items[0]?.name).toBe('Item 01');
  });

  it('does not refetch when clearing filters that are already clear', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = fetchPage.mock.calls.length;
    act(() => result.current.clearFilters());
    await act(async () => { await Promise.resolve(); });
    expect(fetchPage.mock.calls.length).toBe(calls);
  });
});
