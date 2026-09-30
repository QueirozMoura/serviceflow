import { beforeAll, afterAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { buildApp } = await import('../src/app.js');
const app = buildApp();

describe('GET /api/health', () => {
  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('returns the service status', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
