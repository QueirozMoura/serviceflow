import { Prisma, type PrismaClient } from '@prisma/client';
import { MAX_ACCOUNTS_PER_REQUEST } from './tokens.js';

export type LocalAccount = { id: string; organizationId: string; name: string; organizationName: string };
export type ResetPreview = { userId: string; organizationId: string; /** Hashes das OUTRAS contas com o mesmo e-mail (login distingue por senha). */ otherPasswordHashes: string[] };

export interface PasswordResetRepository {
  /** Contas COM senha local para o e-mail (contas so Google nunca entram). */
  findLocalAccounts(email: string): Promise<LocalAccount[]>;
  /** Cria o token, invalidando os anteriores. false = ja houve emissao recente para a conta (nada e criado). */
  issueToken(input: { userId: string; organizationId: string; tokenHash: string; expiresAt: Date; now: Date; cooldownMs: number }): Promise<boolean>;
  /** Apaga um token que nao chegou a ser entregue (nunca foi visto por ninguem, entao nao deixa rastro utilizavel). */
  discardToken(tokenHash: string): Promise<void>;
  /** Token valido (existe, nao usado, nao vencido, conta ainda com senha local) ou null. Nao consome. */
  previewToken(tokenHash: string, now: Date): Promise<ResetPreview | null>;
  /**
   * Numa unica transacao: trava o token, revalida, troca a senha, encerra todos os tokens da conta e revoga todas as suas
   * sessoes. Nao cria sessao. 'invalid' = token inexistente, vencido, usado ou conta sem senha local.
   */
  consumeToken(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<'ok' | 'invalid'>;
}

export class PrismaPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly db: PrismaClient) {}

  async findLocalAccounts(email: string): Promise<LocalAccount[]> {
    const users = await this.db.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' }, passwordHash: { not: null } },
      select: { id: true, organizationId: true, name: true, organization: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_ACCOUNTS_PER_REQUEST,
    });
    return users.map(({ organization, ...user }) => ({ ...user, organizationName: organization.name }));
  }

  async issueToken(input: { userId: string; organizationId: string; tokenHash: string; expiresAt: Date; now: Date; cooldownMs: number }): Promise<boolean> {
    return this.db.$transaction(async (transaction) => {
      // Serializa as emissoes da mesma conta: o intervalo minimo vale mesmo com solicitacoes simultaneas.
      const rows = await transaction.$queryRaw<Array<{ passwordHash: string | null }>>(Prisma.sql`
        SELECT "passwordHash" FROM "User" WHERE "id" = ${input.userId} AND "organizationId" = ${input.organizationId} FOR UPDATE`);
      if (!rows[0] || rows[0].passwordHash === null) return false;
      const recent = await transaction.passwordResetToken.count({ where: { userId: input.userId, organizationId: input.organizationId, createdAt: { gt: new Date(input.now.getTime() - input.cooldownMs) } } });
      if (recent > 0) return false;
      await transaction.passwordResetToken.updateMany({ where: { userId: input.userId, organizationId: input.organizationId, usedAt: null }, data: { usedAt: input.now } });
      await transaction.passwordResetToken.create({ data: { userId: input.userId, organizationId: input.organizationId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, createdAt: input.now } });
      return true;
    });
  }

  async discardToken(tokenHash: string): Promise<void> {
    await this.db.passwordResetToken.deleteMany({ where: { tokenHash, usedAt: null } });
  }

  async previewToken(tokenHash: string, now: Date): Promise<ResetPreview | null> {
    const token = await this.db.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: { select: { email: true, passwordHash: true } } } });
    if (!token || token.usedAt || token.expiresAt <= now || token.user.passwordHash === null) return null;
    const others = await this.db.user.findMany({
      where: { email: { equals: token.user.email, mode: 'insensitive' }, NOT: { id: token.userId, organizationId: token.organizationId }, passwordHash: { not: null } },
      select: { passwordHash: true },
    });
    return { userId: token.userId, organizationId: token.organizationId, otherPasswordHashes: others.flatMap((user) => (user.passwordHash ? [user.passwordHash] : [])) };
  }

  async consumeToken(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<'ok' | 'invalid'> {
    return this.db.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ userId: string; organizationId: string; expiresAt: Date; usedAt: Date | null }>>(Prisma.sql`
        SELECT "userId", "organizationId", "expiresAt", "usedAt" FROM "PasswordResetToken" WHERE "tokenHash" = ${input.tokenHash} FOR UPDATE`);
      const token = rows[0];
      // Estado lido SOB o lock: consumos simultaneos do mesmo token se serializam e so o primeiro vence.
      if (!token || token.usedAt || token.expiresAt <= input.now) return 'invalid';
      const users = await transaction.$queryRaw<Array<{ passwordHash: string | null }>>(Prisma.sql`
        SELECT "passwordHash" FROM "User" WHERE "id" = ${token.userId} AND "organizationId" = ${token.organizationId} FOR UPDATE`);
      // Conta so Google (sem credencial local) nunca ganha senha por este fluxo.
      if (!users[0] || users[0].passwordHash === null) return 'invalid';

      await transaction.user.updateMany({ where: { id: token.userId, organizationId: token.organizationId }, data: { passwordHash: input.passwordHash } });
      await transaction.passwordResetToken.updateMany({ where: { userId: token.userId, organizationId: token.organizationId, usedAt: null }, data: { usedAt: input.now } });
      await transaction.session.updateMany({ where: { userId: token.userId, organizationId: token.organizationId, revokedAt: null }, data: { revokedAt: input.now } });
      return 'ok';
    });
  }
}
