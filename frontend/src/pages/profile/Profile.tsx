import { useRef, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loading } from '../../components/ui/Feedback';
import { Toast } from '../../components/ui/Toast';

const roleLabels: Record<string, string> = { OWNER: 'Proprietário', ADMIN: 'Administrador', TECHNICIAN: 'Técnico', STAFF: 'Atendente' };
const NAME_MIN = 2;
const NAME_MAX = 120;

function validateName(name: string): string | null {
  if (name.length < NAME_MIN) return `Informe um nome com pelo menos ${NAME_MIN} caracteres.`;
  if (name.length > NAME_MAX) return `O nome deve ter no máximo ${NAME_MAX} caracteres.`;
  return null;
}

function saveErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 400) return 'Revise o nome informado.';
  if (cause instanceof ApiError && cause.status === 401) return 'Sua sessão expirou. Entre novamente.';
  return 'Não foi possível salvar o perfil. Tente novamente.';
}

export function Profile() {
  const { user, isLoading, updateProfile } = useAuth();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  if (isLoading) return <Loading message="Carregando perfil..." />;
  if (!user) return null;

  const name = draft ?? user.name;
  const unchanged = name.trim() === user.name;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const trimmed = name.trim();
    const invalid = validateName(trimmed);
    setError(invalid ?? '');
    if (invalid || trimmed === user.name) return;
    submitting.current = true; setSaving(true);
    try {
      await updateProfile({ name: trimmed });
      setDraft(null); setToast('Perfil atualizado.');
    } catch (cause) {
      setError(saveErrorMessage(cause));
    } finally { submitting.current = false; setSaving(false); }
  };

  return <div className="form-page">
    <div className="page-intro compact-intro"><div><p className="eyebrow">Conta</p><h1>Meu perfil</h1><p className="muted">Consulte seus dados e mantenha seu nome atualizado.</p></div></div>
    <Card className="form-card"><form onSubmit={(event) => void submit(event)} noValidate>
      <div className="form-grid">
        <label className="full-field">Nome <span>*</span><input value={name} onChange={(event) => { setDraft(event.target.value); setError(''); }} maxLength={NAME_MAX + 20} autoComplete="name" /></label>
        <label>E-mail<input value={user.email} disabled readOnly /></label>
        <label>Papel<input value={roleLabels[user.role] ?? user.role} disabled readOnly /></label>
        <label className="full-field">Organização<input value={user.organization?.name ?? ''} disabled readOnly /></label>
      </div>
      <p className="muted">O e-mail é usado para entrar na conta e, junto com o papel e a organização, não pode ser alterado aqui.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions"><Button className="button-primary" type="submit" disabled={saving || unchanged}><Save size={16} />{saving ? 'Salvando...' : 'Salvar perfil'}</Button></div>
    </form></Card>
    {toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}
  </div>;
}
