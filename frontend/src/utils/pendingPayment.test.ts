import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllPendingPayments, clearPendingPayment, isDefinitiveRejection, loadPendingPayment, savePendingPayment } from './pendingPayment';

const operation = { key: 'key-12345678', amount: '50', method: 'PIX' as const, createdAt: 1_000_000 };

describe('pendingPayment', () => {
  beforeEach(() => { clearAllPendingPayments(); window.sessionStorage.clear(); });

  it('stores only key, amount, method and creation time, per service order', () => {
    savePendingPayment('order-1', operation);
    expect(JSON.parse(window.sessionStorage.getItem('serviceflow:pending-payment:order-1') ?? '')).toEqual(operation);
    expect(loadPendingPayment('order-2', 1_000_001)).toBeNull();
    expect(loadPendingPayment('order-1', 1_000_001)).toEqual(operation);
  });

  it('reads it back from sessionStorage after a reload (empty in-memory mirror)', async () => {
    window.sessionStorage.setItem('serviceflow:pending-payment:order-1', JSON.stringify(operation));
    vi.resetModules();
    const fresh = await import('./pendingPayment');
    expect(fresh.loadPendingPayment('order-1', 1_000_001)).toEqual(operation);
  });

  it('expires after 24 hours and ignores malformed or incomplete entries', () => {
    savePendingPayment('order-1', operation);
    expect(loadPendingPayment('order-1', operation.createdAt + 24 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(window.sessionStorage.getItem('serviceflow:pending-payment:order-1')).toBeNull();
    window.sessionStorage.setItem('serviceflow:pending-payment:order-3', '{"key":"x"}');
    expect(loadPendingPayment('order-3')).toBeNull();
    window.sessionStorage.setItem('serviceflow:pending-payment:order-4', 'not json');
    expect(loadPendingPayment('order-4')).toBeNull();
  });

  it('clears one entry or all of them (logout) without touching unrelated keys', () => {
    savePendingPayment('order-1', operation); savePendingPayment('order-2', operation);
    window.sessionStorage.setItem('other', 'keep');
    clearPendingPayment('order-1');
    expect(loadPendingPayment('order-1', 1_000_001)).toBeNull();
    expect(loadPendingPayment('order-2', 1_000_001)).toEqual(operation);
    clearAllPendingPayments();
    expect(loadPendingPayment('order-2', 1_000_001)).toBeNull();
    expect(window.sessionStorage.getItem('other')).toBe('keep');
  });

  it('survives an unavailable storage using the in-memory mirror', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    savePendingPayment('order-9', operation);
    expect(loadPendingPayment('order-9', 1_000_001)).toEqual(operation);
    vi.restoreAllMocks();
  });

  it('classifies which failures are definitive refusals', () => {
    expect([400, 401, 403, 404, 409, 429].every(isDefinitiveRejection)).toBe(true);
    expect([408, 500, 502, 503, 504, undefined].some(isDefinitiveRejection)).toBe(false);
  });
});
