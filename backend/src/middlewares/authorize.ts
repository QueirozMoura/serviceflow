import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { hasPermission, type Permission } from '../modules/auth/permissions.js';

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'You do not have permission to perform this action' });
}

/**
 * Para permissoes que dependem do corpo (ex.: o status de destino). Chame depois de validar o corpo e antes de
 * qualquer consulta ao banco; retorna false (e ja responde 403) quando o papel nao tem a permissao.
 */
export function ensurePermission(request: FastifyRequest, reply: FastifyReply, permission: Permission | null): boolean {
  if (permission === null) return true;
  if (request.user && hasPermission(request.user.role, permission)) return true;
  void forbidden(reply);
  return false;
}

/**
 * Deve rodar depois de `authenticate`. O papel vem de request.user, carregado do banco pela sessao;
 * nada do corpo, da URL ou de cabecalhos e considerado. Roda antes da validacao do corpo e da busca do recurso,
 * entao o 403 e igual para recursos existentes, inexistentes ou de outra organizacao.
 */
export function authorize(permission: Permission): preHandlerHookHandler {
  return async function authorizationHook(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    if (!hasPermission(request.user.role, permission)) return forbidden(reply);
  };
}
