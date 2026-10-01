import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { customersService } from '../../services/customers';
import { equipmentService } from '../../services/equipment';
import { ApiError } from '../../services/api';
import type { Customer } from '../../types/customer';
import type { EquipmentInput } from '../../types/equipment';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loading } from '../../components/ui/Feedback';

const emptyForm: EquipmentInput = { customerId: '', type: '', brand: '', model: '', serialNumber: '', description: '' };
// Campos opcionais vazios não são enviados; na edição eles são limpos com null.
const buildPayload = (form: EquipmentInput, editing: boolean) => {
  const entries = Object.entries(form)
    .filter(([key, value]) => key === 'customerId' || key === 'type' || (value ?? '').toString().trim() !== '' || editing)
    .map(([key, value]) => [key, (value ?? '').toString().trim() || null]);
  return Object.fromEntries(entries) as EquipmentInput;
};
export function EquipmentForm() {
  const { id } = useParams(); const [searchParams] = useSearchParams(); const editing = Boolean(id); const navigate = useNavigate(); const [form, setForm] = useState<EquipmentInput>(emptyForm); const [customers, setCustomers] = useState<Customer[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { void (async () => { try { const customersResponse = await customersService.list(); setCustomers(customersResponse.customers); if (id) { const { equipment } = await equipmentService.get(id); setForm({ customerId: equipment.customerId, type: equipment.type, brand: equipment.brand ?? '', model: equipment.model ?? '', serialNumber: equipment.serialNumber ?? '', description: equipment.description ?? '' }); } else if (searchParams.get('customerId')) setForm((current) => ({ ...current, customerId: searchParams.get('customerId') ?? '' })); } catch (cause) { setError(cause instanceof ApiError && cause.status === 404 ? 'Equipamento não encontrado.' : 'Não foi possível carregar os dados do formulário.'); } finally { setLoading(false); } })(); }, [id, searchParams]);
  const update = (field: keyof EquipmentInput, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.customerId || !form.type.trim() || form.type.trim().length < 2) { setError('Selecione um cliente e informe o tipo do equipamento.'); return; } setError(''); setSaving(true); const payload = buildPayload(form, editing && Boolean(id)); payload.customerId = form.customerId; try { const response = editing && id ? await equipmentService.update(id, payload) : await equipmentService.create(payload); navigate(`/equipment/${response.equipment.id}`, { state: { message: editing ? 'Equipamento atualizado com sucesso.' : 'Equipamento criado com sucesso.' } }); } catch (cause) { setError(cause instanceof ApiError && cause.status === 400 ? 'Selecione um cliente válido e revise os campos.' : 'Não foi possível salvar o equipamento.'); } finally { setSaving(false); } };
  if (loading) return <Loading message="Carregando equipamento..." />;
  return <div className="form-page"><Link className="back-link" to={editing && id ? `/equipment/${id}` : '/equipment'}><ArrowLeft size={16} /> Voltar para equipamentos</Link><div className="page-intro compact-intro"><div><p className="eyebrow">Cadastro</p><h2>{editing ? 'Editar equipamento' : 'Novo equipamento'}</h2><p className="muted">Registre os dados técnicos e o cliente responsável.</p></div></div><Card className="form-card"><form onSubmit={submit}><div className="form-grid"><label className="full-field">Cliente <span>*</span><select value={form.customerId} onChange={(event) => update('customerId', event.target.value)}><option value="">Selecione um cliente</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label><label>Tipo <span>*</span><input value={form.type} onChange={(event) => update('type', event.target.value)} placeholder="Ex.: Notebook, geladeira, celular" autoFocus /></label><label>Marca<input value={form.brand ?? ''} onChange={(event) => update('brand', event.target.value)} placeholder="Marca" /></label><label>Modelo<input value={form.model ?? ''} onChange={(event) => update('model', event.target.value)} placeholder="Modelo" /></label><label>Número de série<input value={form.serialNumber ?? ''} onChange={(event) => update('serialNumber', event.target.value)} placeholder="Número de série" /></label><label className="full-field">Descrição<textarea value={form.description ?? ''} onChange={(event) => update('description', event.target.value)} placeholder="Detalhes relevantes do equipamento" rows={4} /></label></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="form-actions"><Link className="button button-secondary" to={editing && id ? `/equipment/${id}` : '/equipment'}>Cancelar</Link><Button className="button-primary" type="submit" disabled={saving}><Save size={16} />{saving ? 'Salvando...' : 'Salvar equipamento'}</Button></div></form></Card></div>;
}
