import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import type { PasswordRecoveryService } from '../modules/password-reset/service.js';
import { forgotPasswordSchema, resetPasswordSchema, resetTokenSchema, validateResetSchema } from '../modules/password-reset/schemas.js';

const invalidToken = (reply: FastifyReply) => reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Reset link not found or no longer valid' });

/** Rotas publicas de recuperacao de senha. O token vai sempre no CORPO (POST), nunca na URL. */
export async function passwordResetRoutes(app: FastifyInstance, options: { service: PasswordRecoveryService }): Promise<void> {
  const { service } = options;
  const tokenOf = (body: unknown) => resetTokenSchema.safeParse((body as { token?: unknown } | null)?.token);

  // Resposta identica para e-mail cadastrado, inexistente ou de conta so Google; o trabalho real acontece depois dela.
  app.post('/forgot', { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid e-mail' });
    reply.header('Cache-Control', 'no-store').status(202).send({ message: 'If an account exists for this e-mail, recovery instructions will be sent' });
    service.start(parsed.data.email, request.log);
    return reply;
  });

  app.post('/validate', { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX * 4, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = validateResetSchema.safeParse(request.body);
    if (!parsed.success || !(await service.validate(parsed.data.token))) return invalidToken(reply);
    reply.header('Cache-Control', 'no-store');
    return reply.send({ valid: true });
  });

  // Define a nova senha e consome o token. NAO cria sessao; as sessoes existentes da conta sao revogadas.
  app.post('/reset', { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX * 2, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      // Token malformado = link invalido; so a senha invalida e erro de validacao (e nao consome o token).
      if (!tokenOf(request.body).success) return invalidToken(reply);
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid password' });
    }
    const outcome = await service.reset(parsed.data.token, parsed.data.password);
    if (outcome === 'invalid') return invalidToken(reply);
    if (outcome === 'reuse') return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Choose a different password' });
    reply.header('Cache-Control', 'no-store');
    return reply.send({ message: 'Password updated' });
  });
}
