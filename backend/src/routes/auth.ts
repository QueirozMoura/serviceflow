import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { loginSchema, registerSchema } from '../modules/auth/schemas.js';
import { PrismaAuthRepository, type AuthRepository } from '../modules/auth/repository.js';
import {
  authenticateAccount,
  createUserSession,
  getPublicAccount,
  getPublicUser,
  isUniqueConstraintError,
  registerAccount,
} from '../modules/auth/service.js';
import { clearSessionCookie, hashSessionToken, setSessionCookie } from '../modules/auth/session.js';

type AuthRoutesOptions = { repository?: AuthRepository; database?: PrismaClient };

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions = {}): Promise<void> {
  const repository = options.repository ?? new PrismaAuthRepository(options.database ?? prisma);
  const requireAuthentication = authenticate(repository);

  app.post('/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid registration data' });
    }

    try {
      const account = await registerAccount(repository, parsed.data);
      return reply.status(201).send(getPublicAccount(account));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Unable to create account' });
      }
      throw error;
    }
  });

  app.post('/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' });
    }

    const user = await authenticateAccount(repository, parsed.data);
    if (!user) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' });
    }

    const token = await createUserSession(repository, user);
    setSessionCookie(reply, token);
    return reply.send({ user: getPublicUser(user) });
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[env.AUTH_COOKIE_NAME];
    if (token) await repository.revokeSession(hashSessionToken(token));
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: requireAuthentication }, async (request, reply) => {
    const user = request.user ? await repository.findUserById(request.user.id) : null;
    if (!user || user.organizationId !== request.user?.organizationId) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    }

    return reply.send({ user: { ...getPublicUser(user), organization: { id: user.organization.id, name: user.organization.name } } });
  });
}