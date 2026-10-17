import { ArrowRight, BadgeDollarSign, CheckCircle2, Clock3, FileText, Search, ShieldCheck, WalletCards, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { paymentsService } from '../../services/payments';
import { quotesService } from '../../services/quotes';
import { warrantiesService } from '../../services/warranties';
import { usePagedList, type PagedResult } from '../../hooks/usePagedList';
import type { OverviewOrder, PaymentOverviewRow, PaymentSummary, QuoteOverviewRow, QuoteSummary, WarrantyOverviewRow, WarrantySummary } from '../../types/overview';
import type { PaymentStatus } from '../../types/payment';
import type { QuoteStatus } from '../../types/quote';
import type { WarrantyStatus } from '../../types/warranty';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/ResourceStates';
import { ErrorState, Loading } from '../../components/ui/Feedback';

type Module = 'quotes' | 'payments' | 'warranties';
type ModuleRecord = { order: OverviewOrder; quote?: QuoteOverviewRow['quote']; payments?: PaymentOverviewRow['payments']; warranty?: WarrantyOverviewRow['warranty'] };
type StatusFilter = 'ALL' | string;

const config: Record<Module, { eyebrow: string; title: string; description: string; empty: string }> = {
  quotes: { eyebrow: 'Financeiro', title: 'Orçamentos', description: 'Consulte os orçamentos vinculados às ordens de serviço.', empty: 'Nenhum orçamento cadastrado.' },
  payments: { eyebrow: 'Financeiro', title: 'Pagamentos', description: 'Acompanhe os recebimentos registrados por ordem de serviço.', empty: 'Nenhum pagamento registrado.' },
  warranties: { eyebrow: 'Pós-venda', title: 'Garantias', description: 'Consulte as garantias vinculadas às ordens entregues.', empty: 'Nenhuma garantia cadastrada.' },
};

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente', APPROVED: 'Aprovado', REJECTED: 'Rejeitado', EXPIRED: 'Expirado',
  PAID: 'Pago', FAILED: 'Falhou', CANCELLED: 'Cancelado', REFUNDED: 'Estornado', ACTIVE: 'Ativa',
};
const methodLabels: Record<string, string> = { PIX: 'PIX', CASH: 'Dinheiro', CARD: 'Cartão', TRANSFER: 'Transferência', OTHER: 'Outro' };
const date = (value: string) => new Intl.DateTimeFormat('pt-BR').format(new Date(value));
const money = (value: string | number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const statusOptions: Record<Module, Array<{ value: StatusFilter; label: string }>> = {
  quotes: [{ value: 'ALL', label: 'Todos os status' }, { value: 'PENDING', label: 'Pendentes' }, { value: 'APPROVED', label: 'Aprovados' }, { value: 'REJECTED', label: 'Recusados' }, { value: 'EXPIRED', label: 'Expirados' }],
  payments: [{ value: 'ALL', label: 'Todos os status' }, { value: 'PENDING', label: 'Pendentes' }, { value: 'PAID', label: 'Pagos' }, { value: 'FAILED', label: 'Falhos' }, { value: 'CANCELLED', label: 'Cancelados' }, { value: 'REFUNDED', label: 'Estornados' }],
  warranties: [{ value: 'ALL', label: 'Todos os status' }, { value: 'ACTIVE', label: 'Ativas' }, { value: 'EXPIRED', label: 'Expiradas' }, { value: 'CANCELLED', label: 'Canceladas' }],
};

// Uma requisição por página (antes: lista de todas as OS + uma chamada por OS). A paginação, a busca e o filtro de
// status são feitos no servidor; os totais dos cartões também vêm dele (calculados sobre toda a organização).
type Summary = QuoteSummary | PaymentSummary | WarrantySummary;
type Filters = { status: string };
const initialFilters: Filters = { status: 'ALL' };

async function fetchModule(module: Module, { page, pageSize, q, filters }: { page: number; pageSize: number; q: string; filters: Filters }): Promise<PagedResult<ModuleRecord, Summary>> {
  const status = filters.status === 'ALL' ? undefined : filters.status;
  if (module === 'quotes') {
    const response = await quotesService.listOverview({ page, pageSize, q, status: status as QuoteStatus | undefined });
    return { items: response.quotes.map(({ serviceOrder, quote }) => ({ order: serviceOrder, quote })), pagination: response.pagination, summary: response.summary };
  }
  if (module === 'warranties') {
    const response = await warrantiesService.listOverview({ page, pageSize, q, status: status as WarrantyStatus | undefined });
    return { items: response.warranties.map(({ serviceOrder, warranty }) => ({ order: serviceOrder, warranty })), pagination: response.pagination, summary: response.summary };
  }
  const response = await paymentsService.listOverview({ page, pageSize, q, status: status as PaymentStatus | undefined });
  return { items: response.payments.map(({ serviceOrder, payments }) => ({ order: serviceOrder, payments })), pagination: response.pagination, summary: response.summary };
}

type Metric = { label: string; value: string | undefined; kind: 'money' | 'count' };
function buildMetrics(module: Module, summary: Summary | undefined): [Metric, Metric, Metric] {
  if (module === 'quotes') {
    const data = summary as QuoteSummary | undefined;
    return [{ label: 'Aguardando aprovação', value: data && String(data.pendingCount), kind: 'count' }, { label: 'Valor aprovado', value: data?.approvedTotal, kind: 'money' }, { label: 'Valor total em orçamentos', value: data?.totalValue, kind: 'money' }];
  }
  if (module === 'payments') {
    const data = summary as PaymentSummary | undefined;
    // "Recebido" soma somente pagamentos pagos; pendentes aparecem a parte e falhos/cancelados/estornados ficam de fora.
    return [{ label: 'Recebido', value: data?.paidTotal, kind: 'money' }, { label: 'Pendente', value: data?.pendingTotal, kind: 'money' }, { label: 'Lançamentos registrados', value: data && String(data.count), kind: 'count' }];
  }
  const data = summary as WarrantySummary | undefined;
  return [{ label: 'Garantias ativas', value: data && String(data.active), kind: 'count' }, { label: 'Garantias expiradas', value: data && String(data.expired), kind: 'count' }, { label: 'Total de garantias', value: data && String(data.total), kind: 'count' }];
}
const formatMetric = ({ value, kind }: Metric) => (value === undefined ? '—' : kind === 'money' ? money(value) : Number(value).toLocaleString('pt-BR'));

export function ModuleList({ module }: { module: Module }) {
  const page = config[module];
  const list = usePagedList<ModuleRecord, Summary, Filters>({ fetchPage: (params) => fetchModule(module, params), initialFilters });
  const total = list.pagination?.total ?? 0;
  const error = list.error instanceof ApiError && list.error.status === 401 ? 'Sua sessão expirou. Entre novamente.' : list.error instanceof ApiError && list.error.status === 403 ? 'Você não tem permissão para acessar esta página.' : `Não foi possível carregar ${page.title.toLocaleLowerCase()}.`;
  const [first, second, third] = buildMetrics(module, list.summary);
  const Icon = module === 'quotes' ? FileText : module === 'payments' ? BadgeDollarSign : ShieldCheck;

  return <div className="resource-page">
    <div className="page-intro financial-page-intro"><div><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1><p className="muted">{page.description}</p></div><Link className="button button-secondary button-small" to="/service-orders"><ArrowRight size={15} /> Ver ordens de serviço</Link></div>
    <div className={`financial-metrics financial-metrics-${module}`}>
      <Card className="financial-metric"><div className="metric-icon metric-icon-blue"><Icon size={18} /></div><div><p>{first.label}</p><strong>{formatMetric(first)}</strong></div></Card>
      <Card className="financial-metric"><div className="metric-icon metric-icon-amber"><Clock3 size={18} /></div><div><p>{second.label}</p><strong>{formatMetric(second)}</strong></div></Card>
      <Card className="financial-metric"><div className="metric-icon metric-icon-teal"><CheckCircle2 size={18} /></div><div><p>{third.label}</p><strong>{formatMetric(third)}</strong></div></Card>
    </div>
    {list.hasActiveFilters ? <p className="financial-summary-note muted" role="note">Os totais acima consideram todos os registros, sem a busca e os filtros aplicados.</p> : null}
    <Card className="resource-card">
      <div className="resource-toolbar financial-toolbar"><label className="search-input"><Search size={16} aria-hidden="true" /><input value={list.search} onChange={(event) => list.setSearch(event.target.value)} placeholder="Buscar por OS ou cliente" aria-label={`Buscar ${page.title.toLocaleLowerCase()}`} /></label><label className="filter-select"><select value={list.filters.status} onChange={(event) => list.setFilter('status', event.target.value)} aria-label="Filtrar por status">{statusOptions[module].map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><span className="result-count">{total} {total === 1 ? 'registro' : 'registros'}</span>{list.hasActiveFilters ? <button className="button button-secondary button-small filters-clear" type="button" onClick={list.clearFilters}><X size={14} aria-hidden="true" /> Limpar filtros</button> : null}</div>
      {list.loading ? <Loading message={`Carregando ${page.title.toLocaleLowerCase()}...`} /> : list.error ? <ErrorState message={error} actionLabel="Tentar novamente" onAction={list.reload} /> : total === 0 && !list.hasActiveFilters ? <EmptyState title={page.empty} message="Os registros aparecerão aqui quando forem vinculados a uma ordem de serviço." actionLabel="Ver ordens de serviço" to="/service-orders" /> : list.items.length === 0 ? <div className="inline-empty"><Search size={20} /><p>Nenhum registro encontrado para essa busca.</p></div> : <div className="table-wrap"><table className="resource-table financial-table"><thead><tr><th>OS</th><th>Cliente</th><th>Informações</th><th>Status</th><th>Atualização</th><th>Ação</th></tr></thead><tbody>{list.items.map((record) => {
        const data = module === 'quotes' ? record.quote : module === 'payments' ? record.payments?.[0] : record.warranty;
        const status = module === 'quotes' ? record.quote?.status : module === 'payments' ? (record.payments?.length === 1 ? record.payments[0].status : `${record.payments?.length} pagamentos`) : record.warranty?.status;
        return <tr key={record.order.id}><td><Link className="resource-name financial-order-link" to={`/service-orders/${record.order.id}`}>{record.order.orderNumber}<small>Ver detalhes da OS <ArrowRight size={12} /></small></Link></td><td>{record.order.customer.name}</td><td>{module === 'quotes' && record.quote ? <><strong className="financial-value">{money(record.quote.total)}</strong><small className="table-subtext">{record.quote.itemsCount} {record.quote.itemsCount === 1 ? 'item' : 'itens'}</small></> : module === 'payments' ? <><strong className="financial-value">{money(record.payments?.reduce((total, payment) => total + Number(payment.amount), 0) ?? 0)}</strong><small className="table-subtext">{record.payments?.length === 1 ? methodLabels[record.payments[0].method] : `${record.payments?.length} lançamentos`}</small></> : record.warranty ? <><span className="warranty-period">{date(record.warranty.startDate)} a {date(record.warranty.endDate)}</span><small className="table-subtext">{record.warranty.description}</small></> : null}</td><td>{typeof status === 'string' && status in statusLabels ? <Badge value={status} /> : <span className="muted">{status}</span>}</td><td>{module === 'quotes' && record.quote ? date(record.quote.updatedAt) : module === 'payments' && data ? date((data as { updatedAt: string }).updatedAt) : record.warranty ? date(record.warranty.updatedAt) : '-'}</td><td><Link className="table-action" to={`/service-orders/${record.order.id}`} aria-label={`Abrir ${record.order.orderNumber}`}><ArrowRight size={16} /></Link></td></tr>;
      })}</tbody></table></div>}
      {!list.error && list.pagination && list.pagination.total > 0 ? <Pagination pagination={list.pagination} shown={list.items.length} noun={['registro', 'registros']} loading={list.loading} onPageChange={list.setPage} /> : null}
    </Card>
    {!list.loading && !list.error && total > 0 ? <p className="financial-list-note"><WalletCards size={15} /> Cadastros, edições e alterações de status são realizados na ordem de serviço correspondente.</p> : null}
  </div>;
}

export function QuotesPage() { return <ModuleList module="quotes" />; }
export function PaymentsPage() { return <ModuleList module="payments" />; }
export function WarrantiesPage() { return <ModuleList module="warranties" />; }
