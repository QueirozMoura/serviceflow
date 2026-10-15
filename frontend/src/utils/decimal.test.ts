import { describe, expect, it } from 'vitest';
import { normalizeDecimalInput } from './decimal';

describe('normalizeDecimalInput', () => {
  it.each([
    ['125', '125'],
    ['125,50', '125.50'],
    ['1.234,56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['1.234', '1234'],
    ['1,234', '1234'],
    ['  125,50 ', '125.50'],
  ])('normalizes %s to %s without using cents', (input, expected) => {
    expect(normalizeDecimalInput(input)).toBe(expected);
  });

  it('preserves zero and turns empty values into null', () => {
    expect(normalizeDecimalInput('0')).toBe('0');
    expect(normalizeDecimalInput('0,00')).toBe('0.00');
    expect(normalizeDecimalInput('')).toBeNull();
    expect(normalizeDecimalInput(null)).toBeNull();
  });
});
