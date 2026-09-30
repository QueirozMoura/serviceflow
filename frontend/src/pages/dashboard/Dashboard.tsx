import { useEffect, useState } from 'react';
import { BadgeDollarSign, Boxes, ClipboardList, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ErrorState, Loading } from '../../components/ui/Feedback';
import { api } from '../../services/api';
import type { DashboardResponse } from '../../types/dashboard';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

const metrics = [
  { key: 'customers', label: 'Clientes', icon: Users, color: 'blue' },
  { key: 'equipment', label: 'Equipamentos', icon: Boxes, color: 'teal' },
  { key: 'serviceOrders', label: 'Ordens de serviço', icon: ClipboardList, color: 'amber' },
  { key: 'quotes', label: 'Orçamentos pendentes', icon: ClipboardList, color: 'rose' },
  { key: 'payments', label: 'Pagamentos recebidos', icon: BadgeDollarSign, color: 'green' },
  { key: 'warranties', label: 'Garantias ativas', icon: ShieldCheck, color: 'violet' },
] as const;

function metricValue(data: DashboardResponse, key: (typeof metrics)[number]['key']) {
  if (key === 'customers') return data.customers.total.toLocaleString('pt-BR');
  if (key === 'equipment') return data.equipment.total.toLocaleString('pt-BR');
  if (key === 'serviceOrders') return data.serviceOrders.total.toLocaleString('pt-BR');
  if (key === 'quotes') return currency.format(Number(data.quotes.pendingTotal));
  if (key === 'payments') return currency.format(Number(data.payments.paidTotal));
  return data.warranties.active.toLocaleString('pt-BR');
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

  return <div className="dashboard-page"><div className="page-intro"><div><p className="eyebrow">Visão geral da operação</p><h2>Bom trabalho, vamos começar.</h2><p className="muted">Aqui está um resumo do que está acontecendo hoje.</p></div><button className="button button-secondary button-small" type="button" onClick={() => void loadDashboard()}><RefreshCw size={15} /> Atualizar</button></div><div className="metric-grid">{metrics.map(({ key, label, icon: Icon, color }) => <Card className="metric-card" key={key}><div className={`metric-icon metric-icon-${color}`}><Icon size={19} /></div><div><p>{label}</p><strong>{metricValue(data, key)}</strong></div></Card>)}</div><Card className="orders-card"><div className="card-heading"><div><p className="eyebrow">Acompanhamento</p><h3>Ordens recentes</h3></div><span className="heading-count">{data.recentServiceOrders.length} registros</span></div>{data.recentServiceOrders.length === 0 ? <div className="empty-state"><ClipboardList size={22} /><p>Nenhuma ordem de serviço registrada ainda.</p></div> : <div className="orders-table-wrap"><table><thead><tr><th>Ordem</th><th>Cliente</th><th>Equipamento</th><th>Status</th><th>Data</th></tr></thead><tbody>{data.recentServiceOrders.map((order) => <tr key={order.id}><td><strong className="order-number">{order.orderNumber}</strong></td><td>{order.customer.name}</td><td>{[order.equipment.brand, order.equipment.model].filter(Boolean).join(' ') || order.equipment.type}</td><td><Badge value={order.status} /></td><td className="muted">{date.format(new Date(order.createdAt))}</td></tr>)}</tbody></table></div>}</Card></div>;
}
