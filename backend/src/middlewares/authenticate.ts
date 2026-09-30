import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { env } from '../config/env.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { clearSessionCookie, hashSessionToken } from '../modules/auth/session.js';

function unauthorized(reply: FastifyReply) {
  clearSessionCookie(reply);
  return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
}

export function authenticate(repository: AuthRepository): preHandlerHookHandler {
  return async function authenticationHook(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[env.AUTH_COOKIE_NAME];
    if (!token) return unauthorized(reply);

    const session = await repository.findSessionByTokenHash(hashSessionToken(token));
    if (!session || session.expiresAt <= new Date()) {
      if (session) await repository.revokeSession(hashSessionToken(token));
      return unauthorized(reply);
    }

    request.user = session.user;
  };
}