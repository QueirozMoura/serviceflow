import { useEffect, useState } from 'react';
import { Eye, Pencil, Plus, Search, Trash2, Wrench, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePagedList } from '../../hooks/usePagedList';
import { customersService } from '../../services/customers';
import { equipmentService } from '../../services/equipment';
import type { CustomerOption } from '../../types/customer';
import type { Equipment } from '../../types/equipment';
import { ApiError } from '../../services/api';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { SearchInput } from '../../components/ui/SearchInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Toast } from '../../components/ui/Toast';
import { EmptyState, ErrorState, Loading } from '../../components/ui/ResourceStates';

const initialFilters = { customerId: '' };
const fetchPage = async ({ page, pageSize, q, filters }: { page: number; pageSize: number; q: string; filters: typeof initialFilters }) => {
  const response = await equipmentService.list({ page, pageSize, q, customerId: filters.customerId || undefined });
  return { items: response.equipment, pagination: response.pagination };
};

export function EquipmentList() {
  const { can } = useAuth();
  const location = useLocation();
  const list = usePagedList<Equipment, undefined, typeof initialFilters>({ fetchPage, initialFilters });
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selected, setSelected] = useState<Equipment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState((location.state as { message?: string } | null)?.message ?? '');

  // As opções do filtro vêm de uma lista enxuta e completa; se falharem, a lista continua funcionando sem o filtro.
  useEffect(() => { void customersService.options().then((response) => setCustomers(response.customers)).catch(() => setCustomers([])); }, []);

  const remove = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await equipmentService.remove(selected.id);
      setSelected(null);
      setToast('Equipamento excluído com sucesso.');
      list.reload();
    } catch (cause) {
      setToast(cause instanceof ApiError && cause.status === 403 ? 'Você não tem permissão para excluir este registro.' : cause instanceof ApiError && cause.status === 409 ? 'Não é possível excluir este equipamento porque existem ordens de serviço vinculadas a ele.' : 'Não foi possível excluir este equipamento.');
    } finally { setDeleting(false); }
  };

  const total = list.pagination?.total ?? 0;
  return <div className="resource-page"><div className="page-intro"><div><p className="eyebrow">Ativos cadastrados</p><h2>Equipamentos</h2><p className="muted">Acompanhe os equipamentos dos seus clientes.</p></div><Link className="button button-primary" to="/equipment/new"><Plus size={17} /> Novo equipamento</Link></div>
    <Card className="resource-card">
      <div className="resource-toolbar equipment-toolbar"><SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar por tipo, marca, modelo ou série" /><label className="filter-select"><Search size={15} /><select value={list.filters.customerId} onChange={(event) => list.setFilter('customerId', event.target.value)} aria-label="Filtrar por cliente"><option value="">Todos os clientes</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label><span className="result-count">{total} {total === 1 ? 'equipamento' : 'equipamentos'}</span>{list.hasActiveFilters ? <button className="button button-secondary button-small filters-clear" type="button" onClick={list.clearFilters}><X size={14} aria-hidden="true" /> Limpar filtros</button> : null}</div>
      {list.loading ? <Loading message="Carregando equipamentos..." /> : list.error ? <ErrorState message="Não foi possível carregar os equipamentos." actionLabel="Tentar novamente" onAction={list.reload} /> : total === 0 && !list.hasActiveFilters ? <EmptyState title="Nenhum equipamento encontrado" message="Cadastre o primeiro equipamento para começar." actionLabel="Novo equipamento" to="/equipment/new" /> : list.items.length === 0 ? <div className="inline-empty"><Wrench size={20} /><p>Nenhum equipamento corresponde aos filtros.</p></div> : <div className="table-wrap"><table className="resource-table"><thead><tr><th>Equipamento</th><th>Cliente</th><th>Número de série</th><th>Ações</th></tr></thead><tbody>{list.items.map((item) => <tr key={item.id}><td><Link className="resource-name" to={`/equipment/${item.id}`}>{[item.brand, item.model].filter(Boolean).join(' ') || item.type}</Link><small className="table-subtext">{item.type}</small></td><td><Link className="subtle-link" to={`/customers/${item.customer.id}`}>{item.customer.name}</Link></td><td className="muted">{item.serialNumber || 'Não informado'}</td><td><div className="row-actions"><Link className="table-action" to={`/equipment/${item.id}`} aria-label="Ver equipamento"><Eye size={16} /></Link><Link className="table-action" to={`/equipment/${item.id}/edit`} aria-label="Editar equipamento"><Pencil size={16} /></Link>{can('equipment:delete') ? <button className="table-action danger-action" type="button" onClick={() => setSelected(item)} aria-label="Excluir equipamento"><Trash2 size={16} /></button> : null}</div></td></tr>)}</tbody></table></div>}
      {!list.error && list.pagination && list.pagination.total > 0 ? <Pagination pagination={list.pagination} shown={list.items.length} noun={['equipamento', 'equipamentos']} loading={list.loading} onPageChange={list.setPage} /> : null}
    </Card>
    <ConfirmDialog isOpen={selected !== null} title="Excluir equipamento?" message="Essa ação não poderá ser desfeita. Ordens de serviço vinculadas impedem a exclusão." isLoading={deleting} onCancel={() => setSelected(null)} onConfirm={() => void remove()} />{toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}</div>;
}
