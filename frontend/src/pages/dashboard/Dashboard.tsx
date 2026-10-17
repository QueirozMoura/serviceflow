import { useEffect, useState } from 'react';
import { ArrowRight, BadgeDollarSign, Boxes, CheckCircle2, ClipboardList, FileCheck2, FileText, Hourglass, PackageCheck, Plus, RefreshCw, ShieldCheck, Stethoscope, Users, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Badge, statusLabel } from '../../components/ui/Badge';
import { BarList, SegmentedBar, type BarItem, type ChartSegment } from '../../components/ui/Charts';
import { ErrorState } from '../../components/ui/Feedback';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import type { DashboardResponse } from '../../types/dashboard';
import { summarizeDashboard, type DashboardSummary } from '../../utils/dashboard';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

const money = (value: string | null | undefined) => {
  const amount = value == null || value === '' ? NaN : Number(value);
  return Number.isFinite(amount) ? currency.format(amount) : 'Não informado';
};
const amountOf = (value: string | null | undefined) => { const amount = Number(value); return Number.isFinite(amount) ? amount : 0; };
const integer = (value: number) => value.toLocaleString('pt-BR');
const plural = (value: number, one: string, many: string) => `${integer(value)} ${value === 1 ? one : many}`;

type Metric = { label: string; value: string; hint?: string; icon: typeof Users; tone: string; to?: string };

/** Indicadores de destaque: o que o dono precisa ver primeiro. */
function buildKpis(data: DashboardResponse, summary: DashboardSummary): Metric[] {
  return [
    { label: 'Ordens abertas', value: integer(summary.openOrders), hint: 'Não entregues nem canceladas', icon: Wrench, tone: 'accent', to: '/service-orders' },
    { label: 'Orçamentos aguardando', value: integer(summary.pendingQuotes), hint: `${money(summary.pendingQuotesTotal)} em aberto`, icon: FileText, tone: 'violet', to: '/quotes' },
    { label: 'Orçamentos aprovados', value: money(summary.approvedQuotesTotal), hint: plural(summary.approvedQuotes, 'orçamento', 'orçamentos'), icon: FileCheck2, tone: 'teal', to: '/quotes' },
    // payments === null: o backend omitiu a receita porque o papel não pode ler pagamentos. Valor ausente continua "Não informado".
    ...(data.payments === null ? [] : [{ label: 'Total recebido', value: money(summary.paidTotal), hint: plural(summary.paidPayments ?? 0, 'pagamento pago', 'pagamentos pagos'), icon: BadgeDollarSign, tone: 'green', to: '/payments' }]),
  ];
}

/** Etapas do fluxo das ordens, em contagens simples. */
function buildStages(summary: DashboardSummary): Metric[] {
  return [
    { label: 'Total de ordens', value: integer(summary.totalOrders), icon: ClipboardList, tone: 'slate' },
    { label: 'Aguardando diagnóstico', value: integer(summary.waitingDiagnosis), icon: Stethoscope, tone: 'amber' },
    { label: 'Aguardando aprovação', value: integer(summary.waitingApproval), icon: Hourglass, tone: 'violet' },
    { label: 'Prontas para retirada', value: integer(summary.readyOrders), icon: PackageCheck, tone: 'accent' },
    { label: 'Ordens entregues', value: integer(summary.deliveredOrders), icon: CheckCircle2, tone: 'green' },
  ];
}

const STATUS_ORDER: Array<[string, string]> = [['RECEIVED', 'slate'], ['WAITING_DIAGNOSIS', 'amber'], ['WAITING_APPROVAL', 'violet'], ['APPROVED', 'teal'], ['IN_PROGRESS', 'blue'], ['READY', 'accent'], ['DELIVERED', 'green'], ['CANCELLED', 'red']];

function MetricCard({ metric, compact = false }: { metric: Metric; compact?: boolean }) {
  const { label, value, hint, icon: Icon, tone, to } = metric;
  const body = <><div className={`metric-icon metric-icon-${tone}`}><Icon size={compact ? 17 : 19} aria-hidden="true" /></div><div className="metric-copy"><p>{label}</p><strong>{value}</strong>{hint ? <small>{hint}</small> : null}</div>{to ? <ArrowRight className="metric-arrow" size={16} aria-hidden="true" /> : null}</>;
  const className = `metric-card${compact ? ' metric-compact' : ''}${tone === 'accent' && !compact ? ' metric-primary' : ''}`;
  return to ? <Link className={`card ${className} metric-link`} to={to}>{body}</Link> : <Card className={className}>{body}</Card>;
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-page" role="status">
      <span className="sr-only">Carregando seu dashboard...</span>
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="kpi-grid" aria-hidden="true">{[0, 1, 2, 3].map((item) => <div className="card skeleton-card" key={item}><span className="skeleton" /><span className="skeleton" /></div>)}</div>
      <div className="dash-grid" aria-hidden="true"><div className="card skeleton-panel"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div><div className="card skeleton-panel"><span className="skeleton" /><span className="skeleton" /></div></div>
    </div>
  );
}

export function Dashboard() {
  const { user, can } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = async (refresh = false) => {
    if (refresh) setIsRefreshing(true); else setIsLoading(true);
    setError('');
    try { setData(await api.get<DashboardResponse>('/api/dashboard')); }
    catch { setError('Não foi possível carregar os dados do dashboard.'); }
    finally { setIsLoading(false); setIsRefreshing(false); }
  };

  useEffect(() => { void loadDashboard(); }, []);

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data) return <ErrorState message={error || 'Nenhum dado disponível.'} actionLabel="Tentar novamente" onAction={() => void loadDashboard()} />;

  const summary = summarizeDashboard(data);
  const byStatus = data.serviceOrders.byStatus;
  const segments: ChartSegment[] = STATUS_ORDER.map(([key, tone]) => ({ key, label: statusLabel(key), value: byStatus[key] ?? 0, tone }));
  const financeItems: BarItem[] = [
    { key: 'pending', label: 'Em aberto (pendentes)', value: amountOf(summary.pendingQuotesTotal), display: money(summary.pendingQuotesTotal), tone: 'violet', hint: plural(summary.pendingQuotes, 'orçamento aguardando resposta', 'orçamentos aguardando resposta') },
    { key: 'approved', label: 'Aprovados', value: amountOf(summary.approvedQuotesTotal), display: money(summary.approvedQuotesTotal), tone: 'teal', hint: plural(summary.approvedQuotes, 'orçamento aprovado', 'orçamentos aprovados') },
    ...(data.payments === null ? [] : [{ key: 'paid', label: 'Recebido', value: amountOf(summary.paidTotal), display: money(summary.paidTotal), tone: 'green', hint: plural(summary.paidPayments ?? 0, 'pagamento pago', 'pagamentos pagos') }]),
  ];
  const firstName = user?.name.split(' ')[0];
  const base: Metric[] = [
    { label: 'Clientes', value: integer(data.customers.total), icon: Users, tone: 'blue', to: '/customers' },
    { label: 'Equipamentos', value: integer(data.equipment.total), icon: Boxes, tone: 'teal', to: '/equipment' },
    { label: 'Garantias ativas', value: integer(data.warranties.active), icon: ShieldCheck, tone: 'violet', to: '/warranties' },
  ];

  return <div className="dashboard-page" aria-busy={isRefreshing}>
    <div className="page-intro">
      <div>
        <p className="eyebrow">Visão geral da operação</p>
        <h1>Bom trabalho, vamos começar.</h1>
        <p className="muted">{firstName ? `Olá, ${firstName}. ` : ''}Aqui está um resumo do que está acontecendo hoje, {today.format(new Date())}.</p>
      </div>
      <div className="heading-actions">
        <button className="button button-secondary" type="button" onClick={() => void loadDashboard(true)} disabled={isRefreshing}><RefreshCw className={isRefreshing ? 'spin' : undefined} size={16} aria-hidden="true" /> {isRefreshing ? 'Atualizando...' : 'Atualizar'}</button>
        {can('serviceOrders:write') ? <Link className="button button-primary" to="/service-orders/new"><Plus size={16} aria-hidden="true" /> Nova OS</Link> : null}
      </div>
    </div>

    {summary.totalOrders === 0 ? <Card className="onboarding">
      <div><p className="eyebrow">Primeiros passos</p><h2>Vamos preparar sua operação</h2><p className="muted">Cadastre seus clientes e equipamentos para abrir a primeira ordem de serviço.</p></div>
      <ol className="onboarding-steps">
        {can('customers:write') ? <li><Link to="/customers/new"><span>1</span> Cadastrar um cliente</Link></li> : null}
        {can('equipment:write') ? <li><Link to="/equipment/new"><span>2</span> Cadastrar um equipamento</Link></li> : null}
        {can('serviceOrders:write') ? <li><Link to="/service-orders/new"><span>3</span> Abrir uma ordem de serviço</Link></li> : null}
      </ol>
    </Card> : null}

    <div className="kpi-grid">{buildKpis(data, summary).map((metric) => <MetricCard metric={metric} key={metric.label} />)}</div>

    <div className="dash-grid">
      <Card className="panel">
        <div className="panel-head"><div><p className="eyebrow">Fluxo das ordens</p><h2>Onde cada atendimento está</h2></div></div>
        <SegmentedBar segments={segments} caption="Ordens por status" />
        <div className="stage-grid">{buildStages(summary).map((metric) => <MetricCard metric={metric} compact key={metric.label} />)}</div>
      </Card>
      <Card className="panel">
        <div className="panel-head"><div><p className="eyebrow">Panorama financeiro</p><h2>Orçamentos e recebimentos</h2></div></div>
        <BarList items={financeItems} caption="Valores acumulados" />
        <p className="panel-note">Valores acumulados reais: orçamentos pendentes e aprovados{data.payments === null ? '' : ' e pagamentos já pagos'}.</p>
      </Card>
    </div>

    <div className="base-strip">{base.map((metric) => <MetricCard metric={metric} compact key={metric.label} />)}</div>

    <Card className="orders-card">
      <div className="card-heading"><div><p className="eyebrow">Acompanhamento</p><h2>Ordens recentes</h2></div><span className="heading-count">{data.recentServiceOrders.length} registros</span></div>
      {data.recentServiceOrders.length === 0 ? <div className="empty-state"><ClipboardList size={22} aria-hidden="true" /><p>Nenhuma ordem de serviço registrada ainda.</p><Link className="button button-primary button-small" to="/service-orders/new"><Plus size={15} aria-hidden="true" /> Criar primeira OS</Link></div> : <div className="orders-table-wrap"><table><thead><tr><th>Ordem</th><th>Cliente</th><th className="hide-sm">Equipamento</th><th>Status</th><th className="hide-sm">Data</th></tr></thead><tbody>{data.recentServiceOrders.map((order) => <tr key={order.id}><td><Link className="resource-name" to={`/service-orders/${order.id}`}><strong className="order-number">{order.orderNumber}</strong></Link></td><td>{order.customer.name}</td><td className="hide-sm">{[order.equipment.brand, order.equipment.model].filter(Boolean).join(' ') || order.equipment.type}</td><td><Badge value={order.status} /></td><td className="muted hide-sm">{date.format(new Date(order.createdAt))}</td></tr>)}</tbody></table></div>}
      {data.recentServiceOrders.length > 0 ? <div className="card-footer-link"><Link to="/service-orders">Ver todas as ordens <ArrowRight size={14} aria-hidden="true" /></Link></div> : null}
    </Card>
  </div>;
}
