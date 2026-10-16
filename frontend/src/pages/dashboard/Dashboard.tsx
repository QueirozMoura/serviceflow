import { useEffect, useState } from 'react';
import { BadgeDollarSign, Boxes, CheckCircle2, ClipboardList, FileCheck2, FileText, Hourglass, PackageCheck, RefreshCw, ShieldCheck, Stethoscope, Users, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ErrorState, Loading } from '../../components/ui/Feedback';
import { api } from '../../services/api';
import type { DashboardResponse } from '../../types/dashboard';
import { summarizeDashboard } from '../../utils/dashboard';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

const money = (value: string | null | undefined) => {
  const amount = value == null || value === '' ? NaN : Number(value);
  return Number.isFinite(amount) ? currency.format(amount) : 'Não informado';
};
const integer = (value: number) => value.toLocaleString('pt-BR');
const plural = (value: number, one: string, many: string) => `${integer(value)} ${value === 1 ? one : many}`;

type Metric = { label: string; value: string; hint?: string; icon: typeof Users; color: string };

function buildMetrics(data: DashboardResponse): Metric[] {
  const summary = summarizeDashboard(data);
  return [
    { label: 'Total de ordens', value: integer(summary.totalOrders), icon: ClipboardList, color: 'amber' },
    { label: 'Ordens abertas', value: integer(summary.openOrders), hint: 'Não entregues nem canceladas', icon: Wrench, color: 'blue' },
    { label: 'Aguardando diagnóstico', value: integer(summary.waitingDiagnosis), icon: Stethoscope, color: 'teal' },
    { label: 'Aguardando aprovação', value: integer(summary.waitingApproval), icon: Hourglass, color: 'rose' },
    { label: 'Prontas para retirada', value: integer(summary.readyOrders), icon: PackageCheck, color: 'violet' },
    { label: 'Ordens entregues', value: integer(summary.deliveredOrders), icon: CheckCircle2, color: 'green' },
    { label: 'Orçamentos aguardando', value: integer(summary.pendingQuotes), hint: `${money(summary.pendingQuotesTotal)} em aberto`, icon: FileText, color: 'rose' },
    { label: 'Orçamentos aprovados', value: money(summary.approvedQuotesTotal), hint: plural(summary.approvedQuotes, 'orçamento', 'orçamentos'), icon: FileCheck2, color: 'teal' },
    // payments === null: o backend omitiu a receita porque o papel não pode ler pagamentos. Valor ausente continua "Não informado".
    ...(data.payments === null ? [] : [{ label: 'Total recebido', value: money(summary.paidTotal), hint: plural(summary.paidPayments ?? 0, 'pagamento pago', 'pagamentos pagos'), icon: BadgeDollarSign, color: 'green' }]),
    { label: 'Clientes', value: integer(data.customers.total), icon: Users, color: 'blue' },
    { label: 'Equipamentos', value: integer(data.equipment.total), icon: Boxes, color: 'teal' },
    { label: 'Garantias ativas', value: integer(data.warranties.active), icon: ShieldCheck, color: 'violet' },
  ];
}

export function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    setIsLoading(true); setError('');
    try { setData(await api.get<DashboardResponse>('/api/dashboard')); }
    catch { setError('Não foi possível carregar os dados do dashboard.'); }
    finally { setIsLoading(false); }
  };

  useEffect(() => { void loadDashboard(); }, []);

  if (isLoading) return <Loading message="Carregando seu dashboard..." />;
  if (error || !data) return <ErrorState message={error || 'Nenhum dado disponível.'} actionLabel="Tentar novamente" onAction={() => void loadDashboard()} />;

  return <div className="dashboard-page"><div className="page-intro"><div><p className="eyebrow">Visão geral da operação</p><h2>Bom trabalho, vamos começar.</h2><p className="muted">Aqui está um resumo do que está acontecendo hoje.</p></div><button className="button button-secondary button-small" type="button" onClick={() => void loadDashboard()}><RefreshCw size={15} /> Atualizar</button></div><div className="metric-grid">{buildMetrics(data).map(({ label, value, hint, icon: Icon, color }) => <Card className="metric-card" key={label}><div className={`metric-icon metric-icon-${color}`}><Icon size={19} /></div><div><p>{label}</p><strong>{value}</strong>{hint ? <small>{hint}</small> : null}</div></Card>)}</div><Card className="orders-card"><div className="card-heading"><div><p className="eyebrow">Acompanhamento</p><h3>Ordens recentes</h3></div><span className="heading-count">{data.recentServiceOrders.length} registros</span></div>{data.recentServiceOrders.length === 0 ? <div className="empty-state"><ClipboardList size={22} /><p>Nenhuma ordem de serviço registrada ainda.</p></div> : <div className="orders-table-wrap"><table><thead><tr><th>Ordem</th><th>Cliente</th><th>Equipamento</th><th>Status</th><th>Data</th></tr></thead><tbody>{data.recentServiceOrders.map((order) => <tr key={order.id}><td><Link className="resource-name" to={`/service-orders/${order.id}`}><strong className="order-number">{order.orderNumber}</strong></Link></td><td>{order.customer.name}</td><td>{[order.equipment.brand, order.equipment.model].filter(Boolean).join(' ') || order.equipment.type}</td><td><Badge value={order.status} /></td><td className="muted">{date.format(new Date(order.createdAt))}</td></tr>)}</tbody></table></div>}</Card></div>;
}
