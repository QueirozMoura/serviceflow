import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../src/utils/redirect.js';

describe('safeReturnPath', () => {
  it('accepts allowed internal paths with query and hash', () => {
    expect(safeReturnPath('/customers/123?tab=history#notes')).toBe('/customers/123?tab=history#notes');
  });

  it.each(['https://evil.example', '//evil.example', '/login', '/\\evil.example', 'javascript:alert(1)'])('rejects invalid destination %s', (value) => {
    expect(safeReturnPath(value)).toBeUndefined();
  });

  it('returns undefined when no destination is provided', () => {
    expect(safeReturnPath(undefined)).toBeUndefined();
  });
});