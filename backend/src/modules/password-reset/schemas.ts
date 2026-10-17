import { z } from 'zod';
import { emailSchema, passwordSchema } from '../auth/schemas.js';

// .strict(): usuario, organizacao ou destinatario enviados pelo cliente sao rejeitados, nao ignorados. O destinatario
// vem sempre do banco, a partir do e-mail informado.
export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

// 32 bytes em base64url = 43 caracteres.
export const resetTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const validateResetSchema = z.object({ token: resetTokenSchema }).strict();
export const resetPasswordSchema = z.object({ token: resetTokenSchema, password: passwordSchema }).strict();
