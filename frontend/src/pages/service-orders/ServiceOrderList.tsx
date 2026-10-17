import { useRef, useState } from 'react';
import { Eye, Plus, Search, Trash2, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePagedList } from '../../hooks/usePagedList';
import { serviceOrdersService } from '../../services/service-orders';
import type { ServiceOrder, ServiceOrderStatus } from '../../types/service-order';
import { ApiError } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Pagination } from '../../components/ui/Pagination';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/ResourceStates';
import { ErrorState, Loading } from '../../components/ui/Feedback';
import { Toast } from '../../components/ui/Toast';
import { serviceOrderDeleteErrorMessage } from './messages';

const statuses: Array<{ value: ServiceOrderStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' }, { value: 'RECEIVED', label: 'Recebida' }, { value: 'WAITING_DIAGNOSIS', label: 'Aguardando diagnóstico' },
  { value: 'WAITING_APPROVAL', label: 'Aguardando aprovação' }, { value: 'APPROVED', label: 'Aprovada' }, { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'READY', label: 'Pronta' }, { value: 'DELIVERED', label: 'Entregue' }, { value: 'CANCELLED', label: 'Cancelada' },
];
const date = (value: string) => new Intl.DateTimeFormat('pt-BR').format(new Date(value));
const equipmentName = (item: ServiceOrder) => [item.equipment.brand, item.equipment.model].filter(Boolean).join(' ') || item.equipment.type;

const initialFilters = { status: '' };
const fetchPage = async ({ page, pageSize, q, filters }: { page: number; pageSize: number; q: string; filters: typeof initialFilters }) => {
  const response = await serviceOrdersService.list({ page, pageSize, q, status: (filters.status || undefined) as ServiceOrderStatus | undefined });
  return { items: response.serviceOrders, pagination: response.pagination };
};

export function ServiceOrderList() {
  const { can } = useAuth();
  const location = useLocation();
  const list = usePagedList<ServiceOrder, undefined, typeof initialFilters>({ fetchPage, initialFilters });
  const [pendingDelete, setPendingDelete] = useState<ServiceOrder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [toast, setToast] = useState((location.state as { message?: string } | null)?.message ?? '');

  const removeOrder = async () => {
    const target = pendingDelete;
    if (!target || deletingRef.current) return;
    deletingRef.current = true; setDeleting(true);
    try {
      await serviceOrdersService.remove(target.id);
      setToast(`${target.orderNumber} excluída.`);
      list.reload();
    } catch (cause) {
      // Uma OS que já não existe no servidor também sai da lista.
      if (cause instanceof ApiError && cause.status === 404) list.reload();
      setToast(serviceOrderDeleteErrorMessage(cause));
    } finally { deletingRef.current = false; setDeleting(false); setPendingDelete(null); }
  };

  const total = list.pagination?.total ?? 0;
  const error = list.error instanceof ApiError && list.error.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível carregar as ordens de serviço.';
  return <div className="resource-page"><div className="page-intro"><div><p className="eyebrow">Operação</p><h1>Ordens de serviço</h1><p className="muted">Acompanhe cada atendimento do recebimento à entrega.</p></div><Link className="button button-primary" to="/service-orders/new"><Plus size={17} /> Nova OS</Link></div>
    <Card className="resource-card">
      <div className="resource-toolbar"><SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar OS, cliente ou equipamento" /><label className="filter-select"><select value={list.filters.status} onChange={(event) => list.setFilter('status', event.target.value)} aria-label="Filtrar por status">{statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><span className="result-count">{total} {total === 1 ? 'ordem' : 'ordens'}</span>{list.hasActiveFilters ? <button className="button button-secondary button-small filters-clear" type="button" onClick={list.clearFilters}><X size={14} aria-hidden="true" /> Limpar filtros</button> : null}</div>
      {list.loading ? <Loading message="Carregando ordens de serviço..." /> : list.error ? <ErrorState message={error} actionLabel="Tentar novamente" onAction={list.reload} /> : total === 0 && !list.hasActiveFilters ? <EmptyState title="Nenhuma ordem de serviço encontrada" message="Crie a primeira OS para iniciar um atendimento." actionLabel="Criar primeira OS" to="/service-orders/new" /> : list.items.length === 0 ? <div className="inline-empty"><Search size={20} /><p>Nenhuma OS encontrada para essa busca.</p></div> : <><div className="table-wrap" tabIndex={0} role="region" aria-label="Tabela de ordens de serviço"><table className="resource-table service-orders-table"><thead><tr><th>OS</th><th>Cliente</th><th>Equipamento</th><th>Status</th><th>Entrada</th><th>Ações</th></tr></thead><tbody>{list.items.map((item) => <tr key={item.id}><td><Link className="resource-name" to={`/service-orders/${item.id}`}>{item.orderNumber}</Link></td><td>{item.customer.name}</td><td><span>{equipmentName(item)}</span><small className="table-subtext">{item.equipment.type}</small></td><td><Badge value={item.status} /></td><td className="muted">{date(item.receivedAt)}</td><td><div className="row-actions"><Link className="table-action" to={`/service-orders/${item.id}`} aria-label={`Ver ${item.orderNumber}`}><Eye size={16} /></Link>{can('serviceOrders:delete') ? <button className="table-action danger-action" type="button" onClick={() => setPendingDelete(item)} disabled={deleting} aria-label={`Excluir ${item.orderNumber}`}><Trash2 size={15} /></button> : null}</div></td></tr>)}</tbody></table></div><div className="service-orders-mobile">{list.items.map((item) => <Link className="service-order-mobile-item" to={`/service-orders/${item.id}`} key={item.id}><div><strong>{item.orderNumber}</strong><span>{item.customer.name}</span><small>{equipmentName(item)} · {date(item.receivedAt)}</small></div><Badge value={item.status} /></Link>)}</div></>}
      {!list.error && list.pagination && list.pagination.total > 0 ? <Pagination pagination={list.pagination} shown={list.items.length} noun={['ordem', 'ordens']} loading={list.loading} onPageChange={list.setPage} /> : null}
    </Card>
    <ConfirmDialog isOpen={pendingDelete !== null} title="Excluir ordem de serviço?" message={pendingDelete ? `A ordem ${pendingDelete.orderNumber} será removida permanentemente. Esta ação não poderá ser desfeita.` : ''} isLoading={deleting} onCancel={() => { if (!deleting) setPendingDelete(null); }} onConfirm={() => void removeOrder()} />{toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}</div>;
}
