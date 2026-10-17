// Gráficos leves, em CSS puro (sem biblioteca): sempre desenhados a partir de dados reais passados por quem os usa.

export interface ChartSegment { key: string; label: string; value: number; tone: string }

const integer = (value: number) => value.toLocaleString('pt-BR');
const percent = (value: number, total: number) => (total === 0 ? '0%' : `${Math.round((value / total) * 100)}%`);

/** Barra empilhada com legenda. `tone` escolhe a cor (classe `tone-<nome>`); a legenda traz texto e número, nunca só cor. */
export function SegmentedBar({ segments, caption }: { segments: ChartSegment[]; caption: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);
  const summary = `${caption}: ${segments.map((segment) => `${segment.label} ${segment.value}`).join(', ')}`;
  return (
    <div className="segmented">
      {total === 0 ? <div className="segmented-empty">Sem registros para exibir.</div> : (
        <div className="segmented-bar" role="img" aria-label={summary}>
          {visible.map((segment) => <span key={segment.key} className={`segment tone-${segment.tone}`} style={{ flexGrow: segment.value }} title={`${segment.label}: ${integer(segment.value)} (${percent(segment.value, total)})`} />)}
        </div>
      )}
      <ul className="legend">
        {segments.map((segment) => (
          <li key={segment.key} className={segment.value === 0 ? 'legend-zero' : undefined}>
            <span className={`legend-dot tone-${segment.tone}`} aria-hidden="true" />
            <span className="legend-label">{segment.label}</span>
            <span className="legend-value">{integer(segment.value)}</span>
            <span className="legend-percent">{percent(segment.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarItem { key: string; label: string; value: number; display: string; tone: string; hint?: string }

/** Barras horizontais proporcionais ao maior valor, com o valor formatado ao lado. */
export function BarList({ items, caption }: { items: BarItem[]; caption: string }) {
  const max = Math.max(...items.map((item) => item.value), 0);
  return (
    <ul className="bar-list" aria-label={caption}>
      {items.map((item) => (
        <li key={item.key}>
          <div className="bar-list-head"><span>{item.label}</span><strong>{item.display}</strong></div>
          <div className="bar-track" aria-hidden="true"><span className={`bar-fill tone-${item.tone}`} style={{ width: max === 0 || item.value === 0 ? '0%' : `${Math.max((item.value / max) * 100, 3)}%` }} /></div>
          {item.hint ? <small>{item.hint}</small> : null}
        </li>
      ))}
    </ul>
  );
}
