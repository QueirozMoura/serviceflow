import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AuthRepository } from '../src/modules/auth/repository.js';
import type { CustomerRepository } from '../src/modules/customers/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { buildApp } = await import('../src/app.js');

const authRepository: AuthRepository = {
  async findSessionByTokenHash() {
    return {
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', organizationId: 'organization-1', role: UserRole.OWNER },
    };
  },
  async revokeSession() {},
} as unknown as AuthRepository;

const customerRepository: CustomerRepository = {
  async create() {
    throw new Prisma.PrismaClientKnownRequestError('Invalid value', {
      code: 'P2023',
      clientVersion: 'test',
    });
  },
  async list() {
    return [];
  },
  async findById() {
    return null;
  },
  async update() {
    return null;
  },
  async delete() {
    return false;
  },
} as unknown as CustomerRepository;

const app: FastifyInstance = buildApp({ authRepository, customerRepository });
const cookie = 'serviceflow_session=test-token';

describe('API error handling', () => {
  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('maps malformed identifiers (Prisma P2023) to 400 without leaking internals', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/customers',
      headers: { cookie },
      payload: { name: 'Maria Silva', phone: '5511999999999' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('Invalid identifier');
    expect(JSON.stringify(body)).not.toContain('Prisma');
  });
});
