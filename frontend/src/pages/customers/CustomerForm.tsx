import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { customersService } from '../../services/customers';
import { ApiError } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loading } from '../../components/ui/Feedback';
import type { CustomerInput } from '../../types/customer';

const emptyForm: CustomerInput = { name: '', email: '', phone: '', document: '', address: '', notes: '' };
// Campos opcionais vazios não são enviados; na edição eles são limpos com null,
// exceto o email, que o backend só aceita preenchido.
const buildPayload = (form: CustomerInput, editing: boolean) => {
  const entries = Object.entries(form)
    .filter(([key, value]) => key === 'name' || key === 'phone' || (value ?? '').toString().trim() !== '' || (editing && key !== 'email'))
    .map(([key, value]) => [key, (value ?? '').toString().trim() || (editing && key !== 'email' ? null : undefined)]);
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as CustomerInput;
};
export function CustomerForm() {
  const { id } = useParams(); const editing = Boolean(id); const navigate = useNavigate(); const [form, setForm] = useState<CustomerInput>(emptyForm); const [loading, setLoading] = useState(editing); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (!id) return; void (async () => { try { const { customer } = await customersService.get(id); setForm({ name: customer.name, email: customer.email ?? '', phone: customer.phone, document: customer.document ?? '', address: customer.address ?? '', notes: customer.notes ?? '' }); } catch (cause) { setError(cause instanceof ApiError && cause.status === 404 ? 'Cliente não encontrado.' : 'Não foi possível carregar o cliente.'); } finally { setLoading(false); } })(); }, [id]);
  const update = (field: keyof CustomerInput, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.name.trim() || form.name.trim().length < 2 || !form.phone.trim() || form.phone.trim().length < 3) { setError('Informe um nome válido e um telefone válido.'); return; } setError(''); setSaving(true); const payload = buildPayload(form, editing && Boolean(id)); try { const response = editing && id ? await customersService.update(id, payload) : await customersService.create(payload); navigate(`/customers/${response.customer.id}`, { state: { message: editing ? 'Cliente atualizado com sucesso.' : 'Cliente criado com sucesso.' } }); } catch (cause) { setError(cause instanceof ApiError && cause.status === 400 ? 'Revise os campos informados.' : 'Não foi possível salvar o cliente.'); } finally { setSaving(false); } };
  if (loading) return <Loading message="Carregando cliente..." />;
  return <div className="form-page"><Link className="back-link" to={editing && id ? `/customers/${id}` : '/customers'}><ArrowLeft size={16} /> Voltar para clientes</Link><div className="page-intro compact-intro"><div><p className="eyebrow">Cadastro</p><h2>{editing ? 'Editar cliente' : 'Novo cliente'}</h2><p className="muted">Mantenha os dados de contato sempre atualizados.</p></div></div><Card className="form-card"><form onSubmit={submit}><div className="form-grid"><label>Nome <span>*</span><input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Nome completo" autoFocus /></label><label>Telefone <span>*</span><input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="(00) 00000-0000" /></label><label>E-mail<input type="email" value={form.email ?? ''} onChange={(event) => update('email', event.target.value)} placeholder="cliente@email.com" /></label><label>CPF/CNPJ<input value={form.document ?? ''} onChange={(event) => update('document', event.target.value)} placeholder="Documento" /></label><label className="full-field">Endereço<input value={form.address ?? ''} onChange={(event) => update('address', event.target.value)} placeholder="Rua, número, bairro, cidade" /></label><label className="full-field">Observações<textarea value={form.notes ?? ''} onChange={(event) => update('notes', event.target.value)} placeholder="Informações importantes sobre o cliente" rows={4} /></label></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="form-actions"><Link className="button button-secondary" to={editing && id ? `/customers/${id}` : '/customers'}>Cancelar</Link><Button className="button-primary" type="submit" disabled={saving}><Save size={16} />{saving ? 'Salvando...' : 'Salvar cliente'}</Button></div></form></Card></div>;
}
