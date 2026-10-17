import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, UserPlus } from 'lucide-react';
import { teamService, invitationLink } from '../../services/team';
import type { InvitableRole, TeamInvitation, TeamMember } from '../../types/team';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState, Loading } from '../../components/ui/Feedback';
import { Toast } from '../../components/ui/Toast';
import { ApiError } from '../../services/api';

const roleLabels: Record<string, string> = { OWNER: 'Proprietário', ADMIN: 'Administrador', TECHNICIAN: 'Técnico' };
const date = (value: string) => new Date(value).toLocaleDateString('pt-BR');

function inviteError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) return 'Esta pessoa já faz parte da sua equipe.';
  if (cause instanceof ApiError && cause.status === 400) return 'Informe um email válido e escolha o papel.';
  if (cause instanceof ApiError && cause.status === 403) return 'Você não tem permissão para gerenciar a equipe.';
  if (cause instanceof ApiError && cause.status === 429) return 'Muitas tentativas. Aguarde um minuto.';
  return 'Não foi possível criar o convite. Tente novamente.';
}

export function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('TECHNICIAN');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // Link recém-criado: existe só aqui, em memória. Fechar a tela o descarta (o servidor não consegue reexibi-lo).
  const [created, setCreated] = useState<{ email: string; link: string } | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try { const [membersResponse, invitationsResponse] = await Promise.all([teamService.members(), teamService.invitations()]); setMembers(membersResponse.members); setInvitations(invitationsResponse.invitations); }
    catch { setLoadError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Informe um email válido.'); return; }
    setError(''); setCreating(true);
    try {
      const response = await teamService.createInvitation({ email: email.trim(), role });
      setCreated({ email: response.invitation.email, link: invitationLink(response.token) });
      setEmail('');
      setInvitations((await teamService.invitations()).invitations);
    } catch (cause) { setError(inviteError(cause)); } finally { setCreating(false); }
  };

  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.link); setToast('Link copiado.'); } catch { setToast('Não foi possível copiar. Selecione o link e copie manualmente.'); }
  };

  const revoke = async (invitation: TeamInvitation) => {
    try { await teamService.revokeInvitation(invitation.id); setInvitations((current) => current.filter((item) => item.id !== invitation.id)); setToast('Convite revogado.'); }
    catch { setToast('Não foi possível revogar o convite.'); }
  };

  if (loading) return <Loading message="Carregando equipe..." />;
  if (loadError) return <ErrorState message="Não foi possível carregar a equipe." actionLabel="Tentar novamente" onAction={() => void load()} />;

  return <div className="resource-page">
    <div className="page-intro"><div><p className="eyebrow">Sistema</p><h1>Equipe</h1><p className="muted">Convide administradores e técnicos para a sua assistência.</p></div></div>
    <Card>
      <div className="section-heading"><h2>Convidar pessoa</h2></div>
      <form className="inline-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="inline-form-grid">
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@exemplo.com" aria-label="Email do convidado" />
          <select value={role} onChange={(event) => setRole(event.target.value as InvitableRole)} aria-label="Papel">
            <option value="TECHNICIAN">Técnico</option><option value="ADMIN">Administrador</option>
          </select>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div><Button className="button-primary button-small" type="submit" disabled={creating}><UserPlus size={15} /> {creating ? 'Criando...' : 'Criar convite'}</Button></div>
      </form>
      <p className="muted form-hint">Nenhum email é enviado: copie o link gerado e compartilhe com a pessoa. Ele vale por 7 dias e só pode ser usado uma vez.</p>
      {created ? <div className="inline-form" role="status"><p><strong>Link para {created.email}</strong> — exibido apenas agora; depois de sair desta tela não será possível vê-lo de novo.</p><input readOnly value={created.link} aria-label="Link do convite" onFocus={(event) => event.currentTarget.select()} /><div><Button className="button-secondary button-small" type="button" onClick={() => void copy()}><Copy size={15} /> Copiar link</Button><Button className="button-secondary button-small" type="button" onClick={() => setCreated(null)}>Ocultar</Button></div></div> : null}
    </Card>
    <Card className="resource-card">
      <div className="card-heading"><h2>Convites pendentes</h2></div>
      {invitations.length === 0 ? <p className="inline-empty">Nenhum convite pendente.</p> : <div className="table-wrap"><table className="resource-table"><thead><tr><th>Email</th><th>Papel</th><th>Validade</th><th>Ações</th></tr></thead><tbody>{invitations.map((invitation) => <tr key={invitation.id}><td>{invitation.email}</td><td>{roleLabels[invitation.role] ?? invitation.role}</td><td>{invitation.status === 'EXPIRED' ? 'Expirado' : `até ${date(invitation.expiresAt)}`}</td><td><button className="table-action table-action-text danger-action" type="button" onClick={() => void revoke(invitation)} aria-label={`Revogar convite de ${invitation.email}`}>Revogar</button></td></tr>)}</tbody></table></div>}
    </Card>
    <Card className="resource-card">
      <div className="card-heading"><h2>Membros</h2></div>
      <div className="table-wrap"><table className="resource-table"><thead><tr><th>Nome</th><th>Email</th><th>Papel</th><th>Desde</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td>{member.name}</td><td>{member.email}</td><td>{roleLabels[member.role] ?? member.role}</td><td>{date(member.createdAt)}</td></tr>)}</tbody></table></div>
    </Card>
    {toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}
  </div>;
}
