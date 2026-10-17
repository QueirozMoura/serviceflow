export type InvitableRole = 'ADMIN' | 'TECHNICIAN';

export interface TeamMember { id: string; name: string; email: string; role: string; createdAt: string }
export interface TeamInvitation { id: string; email: string; role: InvitableRole; expiresAt: string; createdAt: string; status: 'PENDING' | 'EXPIRED' }
export interface InvitationPreview { organizationName: string; email: string; role: InvitableRole }
/** `token` só existe na resposta da criação: o servidor guarda apenas um hash e não consegue reexibi-lo. */
export interface CreatedInvitationResponse { invitation: TeamInvitation; token: string }
