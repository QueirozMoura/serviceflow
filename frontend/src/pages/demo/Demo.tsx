import { ArrowRight, BadgeDollarSign, Boxes, CheckCircle2, ClipboardList, ShieldCheck, Users, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { demoDashboardData } from '../../demo/demoData';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const metrics = [
  { label: 'Clientes', value: demoDashboardData.customers.total, icon: Users, color: 'blue' },
  { label: 'Equipamentos', value: demoDashboardData.equipment.total, icon: Boxes, color: 'teal' },
  { label: 'Ordens abertas', value: demoDashboardData.serviceOrders.total, icon: ClipboardList, color: 'amber' },
  { label: 'Recebimentos', value: currency.format(Number(demoDashboardData.payments?.paidTotal ?? 0)), icon: BadgeDollarSign, color: 'green' },
];

export function Demo() {
  const navigate = useNavigate();

  return (
    <main className="demo-page">
      <header className="demo-header">
        <div className="auth-brand"><div className="brand-mark"><Wrench size={21} /></div><span>Service<span>Flow</span></span></div>
        <div className="demo-header-actions">
          <span className="demo-mode-label"><span className="demo-dot" /> Modo demonstração</span>
          <Button className="button-secondary button-small" type="button" onClick={() => navigate('/login')}>Entrar <ArrowRight size={15} /></Button>
        </div>
      </header>

      <section className="demo-hero">
        <div className="demo-hero-copy">
          <p className="eyebrow">Visão geral da operação</p>
          <h1>Uma assistência técnica mais clara, do primeiro chamado à entrega.</h1>
          <p>Explore uma visão demonstrativa do ServiceFlow com dados fictícios. Quando quiser trabalhar com sua operação, entre ou crie sua conta.</p>
          <div className="demo-hero-actions">
            <Button className="button-primary" type="button" onClick={() => navigate('/login')}>Começar agora <ArrowRight size={16} /></Button>
            <span><CheckCircle2 size={15} /> Dados desta tela são demonstrativos</span>
          </div>
        </div>
        <div className="demo-hero-note"><ShieldCheck size={20} /><div><strong>Seus dados ficam protegidos</strong><span>O modo visitante não acessa nem cria registros reais.</span></div></div>
      </section>

      <section className="demo-content" aria-label="Demonstração do dashboard">
        <div className="demo-section-heading"><div><p className="eyebrow">Painel de exemplo</p><h2>Uma operação em movimento</h2></div><span>Dados fictícios</span></div>
        <div className="demo-metric-grid">
          {metrics.map(({ label, value, icon: Icon, color }) => <Card className="metric-card" key={label}><div className={`metric-icon metric-icon-${color}`}><Icon size={19} /></div><div><p>{label}</p><strong>{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</strong></div></Card>)}
        </div>
        <Card className="demo-orders-card">
          <div className="card-heading"><div><p className="eyebrow">Acompanhamento</p><h3>Ordens recentes</h3></div><span className="heading-count">Amostra demonstrativa</span></div>
          <div className="orders-table-wrap"><table><thead><tr><th>Ordem</th><th>Cliente</th><th>Equipamento</th><th>Status</th></tr></thead><tbody>{demoDashboardData.recentServiceOrders.map((order) => <tr key={order.id}><td><strong className="order-number">{order.orderNumber}</strong></td><td>{order.customer.name}</td><td>{[order.equipment.brand, order.equipment.model].filter(Boolean).join(' ')}</td><td><Badge value={order.status} /></td></tr>)}</tbody></table></div>
        </Card>
      </section>

      <section className="demo-bottom-cta"><div><p className="eyebrow">Pronto para sua operação?</p><h2>Transforme atendimento em processo.</h2></div><Button className="button-primary" type="button" onClick={() => navigate('/login')}>Entrar no ServiceFlow <ArrowRight size={16} /></Button></section>
    </main>
  );
}