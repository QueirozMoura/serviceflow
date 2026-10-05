import { PrismaClient, UserRole } from '@prisma/client';

export interface AuthUserRecord {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  passwordHash: string | null;
  role: UserRole;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface CreatedAccount {
  user: AuthUserRecord;
  organization: AuthUserRecord['organization'];
}

export interface AuthSessionRecord {
  expiresAt: Date;
  user: Pick<AuthUserRecord, 'id' | 'organizationId' | 'role'>;
}

export interface AuthRepository {
  createOrganizationWithOwner(input: {
    organizationName: string;
    slug: string;
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<CreatedAccount>;
  findUsersByEmail(email: string): Promise<AuthUserRecord[]>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  createSession(input: {
    tokenHash: string;
    userId: string;
    organizationId: string;
    expiresAt: Date;
  }): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  revokeSession(tokenHash: string): Promise<void>;
  findUserByOAuthAccount(provider: string, providerAccountId: string): Promise<AuthUserRecord | null>;
  linkOAuthAccount(input: { provider: string; providerAccountId: string; userId: string; organizationId: string }): Promise<void>;
  createOrganizationWithOAuthUser(input: {
    organizationName: string;
    slug: string;
    name: string;
    email: string;
    provider: string;
    providerAccountId: string;
  }): Promise<CreatedAccount>;
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly db: PrismaClient) {}

  async createOrganizationWithOwner(input: {
    organizationName: string;
    slug: string;
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<CreatedAccount> {
    return this.db.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name: input.organizationName, slug: input.slug },
      });
      const user = await transaction.user.create({
        data: {
          organizationId: organization.id,
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          role: UserRole.OWNER,
        },
        include: { organization: true },
      });

      return { user, organization };
    });
  }

  findUsersByEmail(email: string): Promise<AuthUserRecord[]> {
    return this.db.user.findMany({ where: { email }, include: { organization: true } });
  }

  findUserById(id: string): Promise<AuthUserRecord | null> {
    return this.db.user.findUnique({ where: { id }, include: { organization: true } });
  }

  async createSession(input: {
    tokenHash: string;
    userId: string;
    organizationId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.session.create({ data: input });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    const session = await this.db.session.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { user: true },
    });

    if (!session) return null;

    return {
      expiresAt: session.expiresAt,
      user: {
        id: session.user.id,
        organizationId: session.user.organizationId,
        role: session.user.role,
      },
    };
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.db.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  findUserByOAuthAccount(provider: string, providerAccountId: string): Promise<AuthUserRecord | null> {
    return this.db.user.findFirst({
      where: { oauthAccounts: { some: { provider, providerAccountId } } },
      include: { organization: true },
    });
  }

  async linkOAuthAccount(input: { provider: string; providerAccountId: string; userId: string; organizationId: string }): Promise<void> {
    await this.db.oAuthAccount.create({ data: input });
  }

  async createOrganizationWithOAuthUser(input: {
    organizationName: string;
    slug: string;
    name: string;
    email: string;
    provider: string;
    providerAccountId: string;
  }): Promise<CreatedAccount> {
    return this.db.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name: input.organizationName, slug: input.slug },
      });
      const user = await transaction.user.create({
        data: {
          organizationId: organization.id,
          name: input.name,
          email: input.email,
          role: UserRole.OWNER,
        },
        include: { organization: true },
      });
      await transaction.oAuthAccount.create({
        data: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
          userId: user.id,
          organizationId: organization.id,
        },
      });

      return { user, organization };
    });
  }
}