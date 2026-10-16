import { describe, expect, it } from 'vitest';
import { buildQuery } from './query';

describe('buildQuery', () => {
  it('builds a query string and skips empty values', () => {
    expect(buildQuery({ page: 2, pageSize: 20, q: 'dell', status: undefined, customerId: '' })).toBe('?page=2&pageSize=20&q=dell');
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ q: undefined, status: null, customerId: '' })).toBe('');
  });

  it('keeps zero and encodes special characters', () => {
    expect(buildQuery({ page: 0 })).toBe('?page=0');
    expect(buildQuery({ q: 'a&b=c d%_' })).toBe('?q=a%26b%3Dc+d%25_');
  });
});
