import type { MailMessage } from './mailer.js';

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** E-mail de recuperacao. O link contem o token no fragmento (#), que o navegador nunca envia a servidores. */
export function buildPasswordResetEmail(input: { to: string; name: string; organizationName: string; link: string; validForMinutes: number }): MailMessage {
  const subject = 'Redefinição de senha do ServiceFlow';
  const text = [
    `Olá, ${input.name}.`,
    '',
    `Recebemos um pedido para redefinir a senha da sua conta na empresa "${input.organizationName}" no ServiceFlow.`,
    `Para criar uma nova senha, abra o link abaixo (válido por ${input.validForMinutes} minutos e utilizável uma única vez):`,
    '',
    input.link,
    '',
    'Se você não fez este pedido, ignore esta mensagem: sua senha continua a mesma.',
  ].join('\n');
  const html = `<p>Olá, ${escapeHtml(input.name)}.</p>
<p>Recebemos um pedido para redefinir a senha da sua conta na empresa <strong>${escapeHtml(input.organizationName)}</strong> no ServiceFlow.</p>
<p>Para criar uma nova senha, use o botão abaixo (válido por ${input.validForMinutes} minutos e utilizável uma única vez):</p>
<p><a href="${escapeHtml(input.link)}">Redefinir minha senha</a></p>
<p>Se você não fez este pedido, ignore esta mensagem: sua senha continua a mesma.</p>`;
  return { to: input.to, subject, text, html };
}
