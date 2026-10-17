import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { getPublicUser } from '../modules/auth/service.js';
import { createSessionToken, sessionExpiresAt, setSessionCookie } from '../modules/auth/session.js';
import { MemberAlreadyExistsError, PrismaTeamRepository, type TeamRepository } from '../modules/team/repository.js';
import { acceptInvitationSchema, createInvitationSchema, inspectInvitationSchema, invitationIdSchema } from '../modules/team/schemas.js';
import { INVITATION_TTL_MS, createInvitationToken, hashInvitationToken } from '../modules/team/tokens.js';

type TeamRoutesOptions = { authRepository?: AuthRepository; teamRepository?: TeamRepository; database?: PrismaClient };

const notFound = (reply: FastifyReply, message: string) => reply.status(404).send({ statusCode: 404, error: 'Not Found', message });
// Um unico texto para convite inexistente, adulterado, vencido, revogado ou ja usado: nao revela qual deles.
const invalidInvitation = (reply: FastifyReply) => notFound(reply, 'Invitation not found or no longer valid');

/** Equipe da propria organizacao (somente OWNER). organizationId e autor vem sempre da sessao, nunca do corpo/URL. */
export async function teamRoutes(app: FastifyInstance, options: TeamRoutesOptions = {}): Promise<void> {
  const repository = options.teamRepository ?? new PrismaTeamRepository(options.database ?? prisma);
  if (!options.authRepository) throw new Error('Team routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.get('/members', { preHandler: [requireAuthentication, authorize('team:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    return reply.send({ members: await repository.listMembers(request.user.organizationId) });
  });

  app.get('/invitations', { preHandler: [requireAuthentication, authorize('team:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    return reply.send({ invitations: await repository.listInvitations(request.user.organizationId) });
  });

  // O token completo so existe nesta resposta: o banco guarda apenas o hash e ele nao e logado nem recuperavel depois.
  app.post('/invitations', { preHandler: [requireAuthentication, authorize('team:manage')], config: { rateLimit: { max: Math.max(20, env.AUTH_RATE_LIMIT_MAX * 4), timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = createInvitationSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid invitation data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const { token, tokenHash } = createInvitationToken();
    try {
      const invitation = await repository.createInvitation({ organizationId: request.user.organizationId, createdByUserId: request.user.id, email: parsed.data.email, role: parsed.data.role, tokenHash, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) });
      reply.header('Cache-Control', 'no-store');
      return reply.status(201).send({ invitation, token });
    } catch (error) {
      if (error instanceof MemberAlreadyExistsError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'This person is already a member of your team' });
      throw error;
    }
  });

  app.delete('/invitations/:invitationId', { preHandler: [requireAuthentication, authorize('team:manage')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const id = invitationIdSchema.safeParse((request.params as { invitationId: string }).invitationId);
    if (!id.success) return notFound(reply, 'Invitation not found');
    const result = await repository.revokeInvitation(request.user.organizationId, id.data);
    if (result === 'not_found') return notFound(reply, 'Invitation not found');
    if (result === 'accepted') return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invitation was already accepted' });
    return reply.status(204).send();
  });
}

/** Rotas publicas do convidado. O token vai no CORPO (POST), nunca na URL, para nao cair em logs de requisicao. */
export async function invitationRoutes(app: FastifyInstance, options: TeamRoutesOptions = {}): Promise<void> {
  const repository = options.teamRepository ?? new PrismaTeamRepository(options.database ?? prisma);

  app.post('/inspect', { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX * 4, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = inspectInvitationSchema.safeParse(request.body);
    if (!parsed.success) return invalidInvitation(reply);
    const invitation = await repository.previewInvitation(hashInvitationToken(parsed.data.token));
    if (!invitation) return invalidInvitation(reply);
    reply.header('Cache-Control', 'no-store');
    return reply.send({ invitation });
  });

  app.post('/accept', { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX * 2, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = acceptInvitationSchema.safeParse(request.body);
    if (!parsed.success) {
      // Token mal formado e igual a convite invalido; so os demais campos viram erro de validacao.
      if (!inspectInvitationSchema.safeParse({ token: (request.body as { token?: unknown } | null)?.token }).success) return invalidInvitation(reply);
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid registration data' });
    }
    const tokenHash = hashInvitationToken(parsed.data.token);
    const invitation = await repository.previewInvitation(tokenHash);
    if (!invitation) return invalidInvitation(reply);

    // Quem ja tem conta com este e-mail em outra equipe nao pode reutilizar a mesma senha: o login distingue as contas pela senha.
    for (const hash of await repository.existingPasswordHashes(invitation.email)) {
      if (await bcrypt.compare(parsed.data.password, hash)) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Choose a different password' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const session = createSessionToken();
    try {
      const user = await repository.acceptInvitation({ tokenHash, name: parsed.data.name, passwordHash, sessionTokenHash: session.tokenHash, sessionExpiresAt: sessionExpiresAt() });
      if (!user) return invalidInvitation(reply);
      setSessionCookie(reply, session.token);
      reply.header('Cache-Control', 'no-store');
      return reply.status(201).send({ user: getPublicUser(user) });
    } catch (error) {
      if (error instanceof MemberAlreadyExistsError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Unable to accept this invitation' });
      throw error;
    }
  });
}
