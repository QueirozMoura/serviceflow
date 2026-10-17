import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { emailSchema, passwordSchema } from '../auth/schemas.js';

/** Papeis que um convite pode conceder. OWNER nunca: nao ha como convidar nem promover alguem a dono. */
export const invitableRoles = [UserRole.ADMIN, UserRole.TECHNICIAN] as const;

// .strict(): organizationId, createdByUserId, expiresAt etc. enviados pelo cliente sao rejeitados, nao ignorados.
export const createInvitationSchema = z.object({ email: emailSchema, role: z.enum(invitableRoles) }).strict();

// 32 bytes em base64url = 43 caracteres. Formato invalido nem chega ao banco.
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const inspectInvitationSchema = z.object({ token: invitationTokenSchema }).strict();

// O destinatario so informa quem ele e: e-mail, papel e organizacao vem do convite.
export const acceptInvitationSchema = z.object({
  token: invitationTokenSchema,
  name: z.string().trim().min(2).max(120),
  password: passwordSchema,
}).strict();

export const invitationIdSchema = z.string().uuid();

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
