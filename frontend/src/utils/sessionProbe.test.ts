import { describe, expect, it, vi } from 'vitest';

const getSession = vi.hoisted(() => vi.fn());

vi.mock('../services/api', () => ({ api: { get: getSession } }));

const { hasActiveSession } = await import('./sessionProbe');

describe('hasActiveSession', () => {
  it('recognizes a valid session without loading user data', async () => {
    getSession.mockResolvedValueOnce({ authenticated: true });

    await expect(hasActiveSession()).resolves.toBe(true);
    expect(getSession).toHaveBeenCalledWith('/api/auth/session');
  });

  it('keeps visitors unauthenticated', async () => {
    getSession.mockResolvedValueOnce({ authenticated: false });

    await expect(hasActiveSession()).resolves.toBe(false);
  });

  it('treats network failures as an unknown unauthenticated state', async () => {
    getSession.mockRejectedValueOnce(new Error('network unavailable'));

    await expect(hasActiveSession()).resolves.toBe(false);
  });
});