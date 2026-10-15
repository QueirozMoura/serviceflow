import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.CORS_ORIGIN = 'https://serviceflow-wine-seven.vercel.app';

const queryRaw = vi.fn();

vi.mock('../src/lib/prisma.js', () => ({
  prisma: { $queryRaw: queryRaw },
}));

const { buildApp } = await import('../src/app.js');
const app = buildApp();

describe('GET /api/health', () => {
  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('returns the service status when the database is reachable', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://serviceflow-wine-seven.vercel.app' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['access-control-allow-origin']).toBe('https://serviceflow-wine-seven.vercel.app');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers the CORS preflight for the production frontend', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'https://serviceflow-wine-seven.vercel.app',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://serviceflow-wine-seven.vercel.app');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('reports unavailable when the database is unreachable', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'error' });
  });
});
