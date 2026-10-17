import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { loginSchema, registerSchema, updateProfileSchema } from '../modules/auth/schemas.js';
import { PrismaAuthRepository, type AuthRepository } from '../modules/auth/repository.js';
import {
  buildGoogleAuthorizationUrl,
  exchangeCodeForIdentity,
  getGoogleOAuthConfig,
  isGoogleOAuthEnabled,
} from '../modules/auth/google.js';
import {
  AccountAlreadyExistsError,
  authenticateAccount,
  createUserSession,
  getPublicAccount,
  getPublicUser,
  GoogleAccountNotLinkedError,
  isUniqueConstraintError,
  registerAccount,
  resolveGoogleUser,
} from '../modules/auth/service.js';
import {
  clearOAuthStateCookie,
  clearOAuthReturnToCookie,
  clearSessionCookie,
  hashSessionToken,
  readOAuthStateCookie,
  readOAuthReturnToCookie,
  setOAuthReturnToCookie,
  setOAuthStateCookie,
  setSessionCookie,
} from '../modules/auth/session.js';
import { safeReturnPath } from '../utils/redirect.js';

type AuthRoutesOptions = { repository?: AuthRepository; database?: PrismaClient };

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions = {}): Promise<void> {
  const repository = options.repository ?? new PrismaAuthRepository(options.database ?? prisma);
  const requireAuthentication = authenticate(repository);

  app.post('/register', { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid registration data' });
    }

    try {
      const account = await registerAccount(repository, parsed.data);
      return reply.status(201).send(getPublicAccount(account));
    } catch (error) {
      if (error instanceof AccountAlreadyExistsError || isUniqueConstraintError(error)) {
        return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Unable to create account' });
      }
      throw error;
    }
  });

  app.post('/login', { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request, reply) => {
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

  app.get('/session', async (request, reply) => {
    const token = request.cookies[env.AUTH_COOKIE_NAME];
    if (!token) return reply.send({ authenticated: false });

    const session = await repository.findSessionByTokenHash(hashSessionToken(token));
    const authenticated = Boolean(session && session.expiresAt > new Date());
    return reply.send({ authenticated });
  });

  app.get('/me', { preHandler: requireAuthentication }, async (request, reply) => {
    const user = request.user ? await repository.findUserById(request.user.id) : null;
    if (!user || user.organizationId !== request.user?.organizationId) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    }

    return reply.send({ user: { ...getPublicUser(user), organization: { id: user.organization.id, name: user.organization.name } } });
  });

  // A identidade vem somente da sessao; o corpo aceita apenas `name`.
  app.patch('/me', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid profile data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const user = await repository.updateUserName(request.user.id, request.user.organizationId, parsed.data.name);
    if (!user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    return reply.send({ user: { ...getPublicUser(user), organization: { id: user.organization.id, name: user.organization.name } } });
  });

  // Inicia o fluxo OAuth: redireciona o navegador ao Google com state anti-CSRF.
  app.get('/google', async (request, reply) => {
    if (!isGoogleOAuthEnabled()) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Google sign-in is not available' });
    }

    const returnTo = safeReturnPath((request.query as { returnTo?: string }).returnTo);
    const state = randomBytes(24).toString('base64url');
    setOAuthStateCookie(reply, state);
    if (returnTo) setOAuthReturnToCookie(reply, returnTo);
    else clearOAuthReturnToCookie(reply);
    return reply.redirect(buildGoogleAuthorizationUrl(getGoogleOAuthConfig(), state));
  });

  // Callback registrado no Google Cloud. Valida o state, cria a sessao HttpOnly
  // existente e redireciona o navegador de volta ao frontend.
  app.get('/google/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const failureRedirect = env.OAUTH_FAILURE_REDIRECT ?? env.CORS_ORIGIN.split(',')[0]?.trim() ?? '/';

    const fail = (reason: 'oauth' | 'oauth_unlinked' = 'oauth'): void => {
      clearOAuthStateCookie(reply);
      clearOAuthReturnToCookie(reply);
      const separator = failureRedirect.includes('?') ? '&' : '?';
      void reply.redirect(`${failureRedirect}${separator}error=${reason}`);
    };

    if (!isGoogleOAuthEnabled()) {
      return fail();
    }

    const expectedState = readOAuthStateCookie(request.cookies);
    if (!expectedState || !query.state || query.state !== expectedState || query.error || !query.code) {
      return fail();
    }
    const returnTo = safeReturnPath(readOAuthReturnToCookie(request.cookies));
    clearOAuthStateCookie(reply);
    clearOAuthReturnToCookie(reply);

    let user;
    try {
      const identity = await exchangeCodeForIdentity(getGoogleOAuthConfig(), query.code);
      user = await resolveGoogleUser(repository, identity);
    } catch (error) {
      // Sem e-mail nem identificadores no log. Nenhuma sessao e criada e nada foi gravado.
      if (error instanceof GoogleAccountNotLinkedError) {
        request.log.warn('Google sign-in rejected: a local account already uses this e-mail');
        return fail('oauth_unlinked');
      }
      request.log.error({ err: error }, 'Google OAuth callback failed');
      return fail();
    }

    const token = await createUserSession(repository, user);
    setSessionCookie(reply, token);

    const successRedirect = env.OAUTH_SUCCESS_REDIRECT ?? env.CORS_ORIGIN.split(',')[0]?.trim() ?? '/';
    return reply.redirect(returnTo ? new URL(returnTo, successRedirect).toString() : successRedirect);
  });
}