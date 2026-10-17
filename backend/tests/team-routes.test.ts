import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { TeamRepository } from '../src/modules/team/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
// Limites padrao (sem AUTH_RATE_LIMIT_MAX): 5/min no cadastro, 20/min ao consultar e 10/min ao aceitar convite.

const { buildApp } = await import('../src/app.js');

const unusedRepository = (): TeamRepository => ({
  listMembers: async () => [], listInvitations: async () => [], createInvitation: async () => { throw new Error('unused'); },
  revokeInvitation: async () => 'not_found', previewInvitation: async () => null, existingPasswordHashes: async () => [], acceptInvitation: async () => null,
});
const token = 'A'.repeat(43);

describe('public onboarding endpoints are rate limited', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp({ teamRepository: unusedRepository() }); await app.ready(); });
  afterEach(async () => { await app.close(); });

  const statuses = async (url: string, payload: object, count: number) => {
    const out: number[] = [];
    for (let attempt = 0; attempt < count; attempt += 1) out.push((await app.inject({ method: 'POST', url, payload })).statusCode);
    return out;
  };

  it('limits consulting an invitation to 20 attempts per minute', async () => {
    const result = await statuses('/api/auth/invitations/inspect', { token }, 22);
    expect(result.slice(0, 20)).toEqual(Array(20).fill(404));
    expect(result.slice(20)).toEqual([429, 429]);
  });

  it('limits accepting an invitation to 10 attempts per minute', async () => {
    const result = await statuses('/api/auth/invitations/accept', { token, name: 'Ana', password: 'StrongPass1' }, 12);
    expect(result.slice(0, 10)).toEqual(Array(10).fill(404));
    expect(result.slice(10)).toEqual([429, 429]);
  });

  it('limits public signup to 5 attempts per minute', async () => {
    const result = await statuses('/api/auth/register', { organizationName: 'x' }, 7);
    expect(result.slice(0, 5)).toEqual(Array(5).fill(400));
    expect(result.slice(5)).toEqual([429, 429]);
  });

  it('answers a malformed token exactly like an unknown one, and a missing body as invalid', async () => {
    const malformed = await app.inject({ method: 'POST', url: '/api/auth/invitations/accept', payload: { token: 'curto', name: 'Ana', password: 'StrongPass1' } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/invitations/accept', payload: { token, name: 'Ana', password: 'StrongPass1' } });
    expect(malformed.statusCode).toBe(404);
    expect(malformed.json()).toEqual(unknown.json());
    expect((await app.inject({ method: 'POST', url: '/api/auth/invitations/inspect' })).statusCode).toBe(404);
  });

  it('keeps the team endpoints behind authentication', async () => {
    for (const [method, url] of [['GET', '/api/team/members'], ['GET', '/api/team/invitations'], ['POST', '/api/team/invitations'], ['DELETE', '/api/team/invitations/x']] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
