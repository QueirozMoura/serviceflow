import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BadgeDollarSign, CheckCircle2, Clock3, FileText, Search, ShieldCheck, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { paymentsService } from '../../services/payments';
import { quotesService } from '../../services/quotes';
import { serviceOrdersService } from '../../services/service-orders';
import { warrantiesService } from '../../services/warranties';
import type { Payment } from '../../types/payment';
import type { Quote } from '../../types/quote';
import type { ServiceOrder } from '../../types/service-order';
import type { Warranty } from '../../types/warranty';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/ResourceStates';
import { ErrorState, Loading } from '../../components/ui/Feedback';

type Module = 'quotes' | 'payments' | 'warranties';
type ModuleRecord = { order: ServiceOrder; quote?: Quote; payments?: Payment[]; warranty?: Warranty };
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

async function optional<T>(request: () => Promise<T>): Promise<T | null> {
  try {
    return await request();
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }
}

async function loadRecords(module: Module): Promise<ModuleRecord[]> {
  const orders = (await serviceOrdersService.list()).serviceOrders;
  const records = await Promise.all(orders.map(async (order) => {
    if (module === 'quotes') {
      const response = await optional(() => quotesService.get(order.id));
      return response ? { order, quote: response.quote } : null;
    }
    if (module === 'warranties') {
      const response = await optional(() => warrantiesService.get(order.id));
      return response ? { order, warranty: response.warranty } : null;
    }
    const response = await paymentsService.list(order.id);
    return response.payments.length ? { order, payments: response.payments } : null;
  }));
  return records.filter((record) => record !== null) as ModuleRecord[];
}

export function ModuleList({ module }: { module: Module }) {
  const page = config[module];
  const [records, setRecords] = useState<ModuleRecord[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRecords(await loadRecords(module));
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401 ? 'Sua sessão expirou. Entre novamente.' : `Não foi possível carregar ${page.title.toLocaleLowerCase()}.`);
    } finally {
      setLoading(false);
    }
  }, [module, page.title]);

  useEffect(() => { void load(); }, [load]);

  const normalized = search.toLocaleLowerCase();
  const matchesStatus = (record: ModuleRecord) => {
    if (statusFilter === 'ALL') return true;
    if (module === 'quotes') return record.quote?.status === statusFilter;
    if (module === 'warranties') return record.warranty?.status === statusFilter;
    return record.payments?.some((payment) => payment.status === statusFilter) ?? false;
  };
  const filtered = records.filter(({ order }) => [order.orderNumber, order.customer.name].some((value) => value.toLocaleLowerCase().includes(normalized))).filter(matchesStatus);
  const summary = module === 'quotes'
    ? { primary: records.filter((record) => record.quote?.status === 'PENDING').length, primaryLabel: 'Aguardando aprovação', secondary: records.filter((record) => record.quote?.status === 'APPROVED').reduce((total, record) => total + Number(record.quote?.total ?? 0), 0), secondaryLabel: 'Valor aprovado', tertiary: records.reduce((total, record) => total + Number(record.quote?.total ?? 0), 0), tertiaryLabel: 'Valor total em orçamentos' }
    : module === 'payments'
      ? { primary: records.reduce((total, record) => total + (record.payments?.filter((payment) => payment.status === 'PAID').reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0), 0), primaryLabel: 'Recebido', secondary: records.reduce((total, record) => total + (record.payments?.filter((payment) => payment.status === 'PENDING').reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0), 0), secondaryLabel: 'Pendente', tertiary: records.reduce((total, record) => total + (record.payments?.length ?? 0), 0), tertiaryLabel: 'Lançamentos registrados' }
      : { primary: records.filter((record) => record.warranty?.status === 'ACTIVE').length, primaryLabel: 'Garantias ativas', secondary: records.filter((record) => record.warranty?.status === 'EXPIRED').length, secondaryLabel: 'Garantias expiradas', tertiary: records.length, tertiaryLabel: 'Total de garantias' };
  const Icon = module === 'quotes' ? FileText : module === 'payments' ? BadgeDollarSign : ShieldCheck;
  const formatSummary = (value: number, label: string) => label.includes('Valor') || label === 'Recebido' || label === 'Pendente' ? money(value) : value.toLocaleString('pt-BR');

  return <div className="resource-page">
    <div className="page-intro financial-page-intro"><div><p className="eyebrow">{page.eyebrow}</p><h2>{page.title}</h2><p className="muted">{page.description}</p></div><Link className="button button-secondary button-small" to="/service-orders"><ArrowRight size={15} /> Ver ordens de serviço</Link></div>
    <div className={`financial-metrics financial-metrics-${module}`}>
      <Card className="financial-metric"><div className="metric-icon metric-icon-blue"><Icon size={18} /></div><div><p>{summary.primaryLabel}</p><strong>{formatSummary(summary.primary, summary.primaryLabel)}</strong></div></Card>
      <Card className="financial-metric"><div className="metric-icon metric-icon-amber"><Clock3 size={18} /></div><div><p>{summary.secondaryLabel}</p><strong>{formatSummary(summary.secondary, summary.secondaryLabel)}</strong></div></Card>
      <Card className="financial-metric"><div className="metric-icon metric-icon-teal"><CheckCircle2 size={18} /></div><div><p>{summary.tertiaryLabel}</p><strong>{formatSummary(summary.tertiary, summary.tertiaryLabel)}</strong></div></Card>
    </div>
    <Card className="resource-card">
      <div className="resource-toolbar financial-toolbar"><label className="search-input"><Search size={16} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por OS ou cliente" aria-label={`Buscar ${page.title.toLocaleLowerCase()}`} /></label><label className="filter-select"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por status">{statusOptions[module].map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><span className="result-count">{filtered.length} {filtered.length === 1 ? 'registro' : 'registros'}</span></div>
      {loading ? <Loading message={`Carregando ${page.title.toLocaleLowerCase()}...`} /> : error ? <ErrorState message={error} actionLabel="Tentar novamente" onAction={() => void load()} /> : records.length === 0 ? <EmptyState title={page.empty} message="Os registros aparecerão aqui quando forem vinculados a uma ordem de serviço." actionLabel="Ver ordens de serviço" to="/service-orders" /> : filtered.length === 0 ? <div className="inline-empty"><Search size={20} /><p>Nenhum registro encontrado para essa busca.</p></div> : <div className="table-wrap"><table className="resource-table financial-table"><thead><tr><th>OS</th><th>Cliente</th><th>Informações</th><th>Status</th><th>Atualização</th><th>Ação</th></tr></thead><tbody>{filtered.map((record) => {
        const data = module === 'quotes' ? record.quote : module === 'payments' ? record.payments?.[0] : record.warranty;
        const status = module === 'quotes' ? record.quote?.status : module === 'payments' ? (record.payments?.length === 1 ? record.payments[0].status : `${record.payments?.length} pagamentos`) : record.warranty?.status;
        return <tr key={record.order.id}><td><Link className="resource-name financial-order-link" to={`/service-orders/${record.order.id}`}>{record.order.orderNumber}<small>Ver detalhes da OS <ArrowRight size={12} /></small></Link></td><td>{record.order.customer.name}</td><td>{module === 'quotes' && record.quote ? <><strong className="financial-value">{money(record.quote.total)}</strong><small className="table-subtext">{record.quote.items.length} {record.quote.items.length === 1 ? 'item' : 'itens'}</small></> : module === 'payments' ? <><strong className="financial-value">{money(record.payments?.reduce((total, payment) => total + Number(payment.amount), 0) ?? 0)}</strong><small className="table-subtext">{record.payments?.length === 1 ? methodLabels[record.payments[0].method] : `${record.payments?.length} lançamentos`}</small></> : record.warranty ? <><span className="warranty-period">{date(record.warranty.startDate)} a {date(record.warranty.endDate)}</span><small className="table-subtext">{record.warranty.description}</small></> : null}</td><td>{typeof status === 'string' && status in statusLabels ? <Badge value={status} /> : <span className="muted">{status}</span>}</td><td>{module === 'quotes' && record.quote ? date(record.quote.updatedAt) : module === 'payments' && data ? date((data as Payment).updatedAt) : record.warranty ? date(record.warranty.updatedAt) : '-'}</td><td><Link className="table-action" to={`/service-orders/${record.order.id}`} aria-label={`Abrir ${record.order.orderNumber}`}><ArrowRight size={16} /></Link></td></tr>;
      })}</tbody></table></div>}
    </Card>
    {!loading && !error && records.length > 0 ? <p className="financial-list-note"><WalletCards size={15} /> Cadastros, edições e alterações de status são realizados na ordem de serviço correspondente.</p> : null}
  </div>;
}

export function QuotesPage() { return <ModuleList module="quotes" />; }
export function PaymentsPage() { return <ModuleList module="payments" />; }
export function WarrantiesPage() { return <ModuleList module="warranties" />; }
