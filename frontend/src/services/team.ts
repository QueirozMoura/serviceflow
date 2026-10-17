import { api } from './api';
import type { CreatedInvitationResponse, InvitableRole, InvitationPreview, TeamInvitation, TeamMember } from '../types/team';

export const teamService = {
  members: () => api.get<{ members: TeamMember[] }>('/api/team/members'),
  invitations: () => api.get<{ invitations: TeamInvitation[] }>('/api/team/invitations'),
  createInvitation: (input: { email: string; role: InvitableRole }) => api.post<CreatedInvitationResponse>('/api/team/invitations', input),
  revokeInvitation: (id: string) => api.delete<void>(`/api/team/invitations/${id}`),
  /** O token vai no corpo (POST), nunca na URL da API, para não aparecer em logs de requisição. */
  inspectInvitation: (token: string) => api.post<{ invitation: InvitationPreview }>('/api/auth/invitations/inspect', { token }),
};

/** Link entregue ao convidado. O token fica no fragmento (#), que o navegador nunca envia a nenhum servidor. */
export function invitationLink(token: string): string {
  return `${window.location.origin}/invite#t=${token}`;
}

export function tokenFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('t');
}
