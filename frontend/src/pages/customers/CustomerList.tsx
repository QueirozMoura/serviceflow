import { useState } from 'react';
import { Eye, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePagedList } from '../../hooks/usePagedList';
import { customersService } from '../../services/customers';
import type { Customer } from '../../types/customer';
import { ApiError } from '../../services/api';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { SearchInput } from '../../components/ui/SearchInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Toast } from '../../components/ui/Toast';
import { EmptyState, ErrorState, Loading } from '../../components/ui/ResourceStates';

const noFilters = {};
const fetchPage = async ({ page, pageSize, q }: { page: number; pageSize: number; q: string }) => {
  const response = await customersService.list({ page, pageSize, q });
  return { items: response.customers, pagination: response.pagination };
};

export function CustomerList() {
  const { can } = useAuth();
  const location = useLocation();
  const list = usePagedList<Customer>({ fetchPage, initialFilters: noFilters });
  const [selected, setSelected] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState((location.state as { message?: string } | null)?.message ?? '');

  const remove = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await customersService.remove(selected.id);
      setSelected(null);
      setToast('Cliente excluído com sucesso.');
      list.reload();
    } catch (cause) {
      setToast(cause instanceof ApiError && cause.status === 403 ? 'Você não tem permissão para excluir este registro.' : cause instanceof ApiError && cause.status === 409 ? 'Não é possível excluir este cliente porque existem registros vinculados a ele.' : 'Não foi possível excluir este cliente.');
    } finally { setDeleting(false); }
  };

  const total = list.pagination?.total ?? 0;
  return <div className="resource-page"><div className="page-intro"><div><p className="eyebrow">Base de atendimento</p><h1>Clientes</h1><p className="muted">Gerencie os clientes da sua assistência.</p></div><Link className="button button-primary" to="/customers/new"><Plus size={17} /> Novo cliente</Link></div>
    <Card className="resource-card">
      <div className="resource-toolbar"><SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar cliente por nome, telefone ou email" /><span className="result-count">{total} {total === 1 ? 'cliente' : 'clientes'}</span>{list.hasActiveFilters ? <button className="button button-secondary button-small filters-clear" type="button" onClick={list.clearFilters}><X size={14} aria-hidden="true" /> Limpar filtros</button> : null}</div>
      {list.loading ? <Loading message="Carregando clientes..." /> : list.error ? <ErrorState message="Não foi possível carregar os clientes." actionLabel="Tentar novamente" onAction={list.reload} /> : total === 0 && !list.hasActiveFilters ? <EmptyState title="Nenhum cliente encontrado" message="Cadastre o primeiro cliente para começar." actionLabel="Novo cliente" to="/customers/new" /> : list.items.length === 0 ? <div className="inline-empty"><Users size={20} /><p>Nenhum cliente corresponde à busca.</p></div> : <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabela de clientes"><table className="resource-table"><thead><tr><th>Cliente</th><th>Telefone</th><th>E-mail</th><th className="actions-heading">Ações</th></tr></thead><tbody>{list.items.map((customer) => <tr key={customer.id}><td><Link className="resource-name" to={`/customers/${customer.id}`}>{customer.name}</Link></td><td>{customer.phone}</td><td className="muted">{customer.email || 'Não informado'}</td><td><div className="row-actions"><Link className="table-action" to={`/customers/${customer.id}`} aria-label={`Ver ${customer.name}`}><Eye size={16} /></Link><Link className="table-action" to={`/customers/${customer.id}/edit`} aria-label={`Editar ${customer.name}`}><Pencil size={16} /></Link>{can('customers:delete') ? <button className="table-action danger-action" type="button" onClick={() => setSelected(customer)} aria-label={`Excluir ${customer.name}`}><Trash2 size={16} /></button> : null}</div></td></tr>)}</tbody></table></div>}
      {!list.error && list.pagination && list.pagination.total > 0 ? <Pagination pagination={list.pagination} shown={list.items.length} noun={['cliente', 'clientes']} loading={list.loading} onPageChange={list.setPage} /> : null}
    </Card>
    <ConfirmDialog isOpen={selected !== null} title="Excluir cliente?" message="Essa ação não poderá ser desfeita. Clientes com registros vinculados podem não ser removidos." isLoading={deleting} onCancel={() => setSelected(null)} onConfirm={() => void remove()} />{toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}</div>;
}
