import { Prisma, UserRole, type PrismaClient } from '@prisma/client';
import type { AuthUserRecord } from '../auth/repository.js';

export type MemberRecord = { id: string; name: string; email: string; role: UserRole; createdAt: Date };
export type InvitationRecord = { id: string; email: string; role: UserRole; expiresAt: Date; createdAt: Date; status: 'PENDING' | 'EXPIRED' };
export type InvitationPreview = { organizationName: string; email: string; role: UserRole };

export class MemberAlreadyExistsError extends Error {}

export interface TeamRepository {
  listMembers(organizationId: string): Promise<MemberRecord[]>;
  /** Convites ainda nao aceitos nem revogados (vencidos aparecem como EXPIRED). */
  listInvitations(organizationId: string, now?: Date): Promise<InvitationRecord[]>;
  /** Revoga os pendentes do mesmo e-mail e cria o novo. MemberAlreadyExistsError se o e-mail ja e membro desta organizacao. */
  createInvitation(input: { organizationId: string; createdByUserId: string; email: string; role: UserRole; tokenHash: string; expiresAt: Date }): Promise<InvitationRecord>;
  /** 'accepted' = ja foi usado (nao se revoga); revogar duas vezes e inofensivo. */
  revokeInvitation(organizationId: string, invitationId: string): Promise<'revoked' | 'not_found' | 'accepted'>;
  /** Somente convites validos (nao aceitos, nao revogados, nao vencidos); qualquer outro caso e null. */
  previewInvitation(tokenHash: string, now?: Date): Promise<InvitationPreview | null>;
  /** E-mail do convite valido, para checar reuso de senha antes de aceitar (null = convite invalido). */
  existingPasswordHashes(email: string): Promise<string[]>;
  /**
   * Aceita o convite numa unica transacao: trava o convite, revalida o estado, cria o usuario (com a organizacao, o papel
   * e o e-mail DO CONVITE), marca-o como aceito e cria a sessao. Qualquer falha desfaz tudo. null = convite invalido.
   */
  acceptInvitation(input: { tokenHash: string; name: string; passwordHash: string; sessionTokenHash: string; sessionExpiresAt: Date; now?: Date }): Promise<AuthUserRecord | null>;
}

export class PrismaTeamRepository implements TeamRepository {
  constructor(private readonly db: PrismaClient) {}

  listMembers(organizationId: string): Promise<MemberRecord[]> {
    return this.db.user.findMany({ where: { organizationId }, select: { id: true, name: true, email: true, role: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async listInvitations(organizationId: string, now = new Date()): Promise<InvitationRecord[]> {
    const rows = await this.db.invitation.findMany({
      where: { organizationId, acceptedAt: null, revokedAt: null },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ ...row, status: row.expiresAt > now ? 'PENDING' : 'EXPIRED' }));
  }

  async createInvitation(input: { organizationId: string; createdByUserId: string; email: string; role: UserRole; tokenHash: string; expiresAt: Date }): Promise<InvitationRecord> {
    return this.db.$transaction(async (transaction) => {
      // Serializa convites da mesma organizacao: duas criacoes simultaneas para o mesmo e-mail nao deixam dois links validos.
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${input.organizationId} FOR UPDATE`;
      const member = await transaction.user.findFirst({ where: { organizationId: input.organizationId, email: { equals: input.email, mode: 'insensitive' } }, select: { id: true } });
      if (member) throw new MemberAlreadyExistsError();
      await transaction.invitation.updateMany({ where: { organizationId: input.organizationId, email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const created = await transaction.invitation.create({
        data: { organizationId: input.organizationId, createdByUserId: input.createdByUserId, email: input.email, role: input.role, tokenHash: input.tokenHash, expiresAt: input.expiresAt },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      });
      return { ...created, status: 'PENDING' as const };
    });
  }

  async revokeInvitation(organizationId: string, invitationId: string): Promise<'revoked' | 'not_found' | 'accepted'> {
    return this.db.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ acceptedAt: Date | null; revokedAt: Date | null }>>`
        SELECT "acceptedAt", "revokedAt" FROM "Invitation" WHERE "id" = ${invitationId} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const row = rows[0];
      if (!row) return 'not_found';
      if (row.acceptedAt) return 'accepted';
      if (!row.revokedAt) await transaction.invitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
      return 'revoked';
    });
  }

  async previewInvitation(tokenHash: string, now = new Date()): Promise<InvitationPreview | null> {
    const invitation = await this.db.invitation.findUnique({ where: { tokenHash }, include: { organization: { select: { name: true } } } });
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now) return null;
    return { organizationName: invitation.organization.name, email: invitation.email, role: invitation.role };
  }

  async existingPasswordHashes(email: string): Promise<string[]> {
    const users = await this.db.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: { passwordHash: true } });
    return users.flatMap((user) => (user.passwordHash ? [user.passwordHash] : []));
  }

  async acceptInvitation(input: { tokenHash: string; name: string; passwordHash: string; sessionTokenHash: string; sessionExpiresAt: Date; now?: Date }): Promise<AuthUserRecord | null> {
    const now = input.now ?? new Date();
    return this.db.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string; organizationId: string; email: string; role: UserRole; expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null }>>`
        SELECT "id", "organizationId", "email", "role", "expiresAt", "acceptedAt", "revokedAt" FROM "Invitation" WHERE "tokenHash" = ${input.tokenHash} FOR UPDATE`;
      const invitation = rows[0];
      // Estado lido SOB o lock: dois aceites simultaneos se serializam e o segundo ve o convite ja usado.
      if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now) return null;
      try {
        const user = await transaction.user.create({
          data: { organizationId: invitation.organizationId, name: input.name, email: invitation.email, passwordHash: input.passwordHash, role: invitation.role },
          include: { organization: true },
        });
        await transaction.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: now } });
        await transaction.session.create({ data: { tokenHash: input.sessionTokenHash, userId: user.id, organizationId: user.organizationId, expiresAt: input.sessionExpiresAt } });
        return user;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new MemberAlreadyExistsError();
        throw error;
      }
    });
  }
}
