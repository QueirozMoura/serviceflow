import { useCallback, useEffect, useState } from 'react';
import { Eye, Plus, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { serviceOrdersService } from '../../services/service-orders';
import type { ServiceOrder, ServiceOrderStatus } from '../../types/service-order';
import { ApiError } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/ResourceStates';
import { ErrorState, Loading } from '../../components/ui/Feedback';

const statuses: Array<{ value: ServiceOrderStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' }, { value: 'RECEIVED', label: 'Recebida' }, { value: 'WAITING_DIAGNOSIS', label: 'Aguardando diagnóstico' },
  { value: 'WAITING_APPROVAL', label: 'Aguardando aprovação' }, { value: 'APPROVED', label: 'Aprovada' }, { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'READY', label: 'Pronta' }, { value: 'DELIVERED', label: 'Entregue' }, { value: 'CANCELLED', label: 'Cancelada' },
];
const date = (value: string) => new Intl.DateTimeFormat('pt-BR').format(new Date(value));
const equipmentName = (item: ServiceOrder) => [item.equipment.brand, item.equipment.model].filter(Boolean).join(' ') || item.equipment.type;

export function ServiceOrderList() {
  const [items, setItems] = useState<ServiceOrder[]>([]); const [search, setSearch] = useState(''); const [status, setStatus] = useState<ServiceOrderStatus | ''>(''); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { setItems((await serviceOrdersService.list(status || undefined)).serviceOrders); } catch (cause) { setError(cause instanceof ApiError && cause.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível carregar as ordens de serviço.'); } finally { setLoading(false); } }, [status]);
  useEffect(() => { void load(); }, [load]);
  const normalized = search.toLocaleLowerCase(); const filtered = items.filter((item) => [item.orderNumber, item.customer.name, equipmentName(item)].some((value) => value.toLocaleLowerCase().includes(normalized)));
  return <div className="resource-page"><div className="page-intro"><div><p className="eyebrow">Operação</p><h2>Ordens de serviço</h2><p className="muted">Acompanhe cada atendimento do recebimento à entrega.</p></div><Link className="button button-primary" to="/service-orders/new"><Plus size={17} /> Nova OS</Link></div><Card className="resource-card"><div className="resource-toolbar"><label className="search-input"><Search size={16} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar OS, cliente ou equipamento" aria-label="Buscar ordens de serviço" /></label><label className="filter-select"><select value={status} onChange={(event) => setStatus(event.target.value as ServiceOrderStatus | '')} aria-label="Filtrar por status">{statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><span className="result-count">{filtered.length} {filtered.length === 1 ? 'ordem' : 'ordens'}</span></div>{loading ? <Loading message="Carregando ordens de serviço..." /> : error ? <ErrorState message={error} actionLabel="Tentar novamente" onAction={() => void load()} /> : items.length === 0 ? <EmptyState title="Nenhuma ordem de serviço encontrada" message="Crie a primeira OS para iniciar um atendimento." actionLabel="Criar primeira OS" to="/service-orders/new" /> : filtered.length === 0 ? <div className="inline-empty"><Search size={20} /><p>Nenhuma OS encontrada para essa busca.</p></div> : <><div className="table-wrap"><table className="resource-table service-orders-table"><thead><tr><th>OS</th><th>Cliente</th><th>Equipamento</th><th>Status</th><th>Entrada</th><th>Ações</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><Link className="resource-name" to={`/service-orders/${item.id}`}>{item.orderNumber}</Link></td><td>{item.customer.name}</td><td><span>{equipmentName(item)}</span><small className="table-subtext">{item.equipment.type}</small></td><td><Badge value={item.status} /></td><td className="muted">{date(item.receivedAt)}</td><td><Link className="table-action" to={`/service-orders/${item.id}`} aria-label={`Ver ${item.orderNumber}`}><Eye size={16} /></Link></td></tr>)}</tbody></table></div><div className="service-orders-mobile">{filtered.map((item) => <Link className="service-order-mobile-item" to={`/service-orders/${item.id}`} key={item.id}><div><strong>{item.orderNumber}</strong><span>{item.customer.name}</span><small>{equipmentName(item)} · {date(item.receivedAt)}</small></div><Badge value={item.status} /></Link>)}</div></>}</Card></div>;
}
