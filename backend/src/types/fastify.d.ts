import type { UserRole } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      organizationId: string;
      role: UserRole;
    } | null;
  }
}