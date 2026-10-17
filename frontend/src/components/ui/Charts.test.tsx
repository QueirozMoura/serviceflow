import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BarList, SegmentedBar } from './Charts';

const segments = [{ key: 'a', label: 'Recebida', value: 3, tone: 'slate' }, { key: 'b', label: 'Entregue', value: 1, tone: 'green' }, { key: 'c', label: 'Cancelada', value: 0, tone: 'red' }];

describe('SegmentedBar', () => {
  it('draws one segment per non-zero value and lists every status with count and percentage', () => {
    const { container } = render(<SegmentedBar segments={segments} caption="Ordens por status" />);
    expect(container.querySelectorAll('.segment')).toHaveLength(2);
    const bar = screen.getByRole('img');
    expect(bar.getAttribute('aria-label')).toBe('Ordens por status: Recebida 3, Entregue 1, Cancelada 0');
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toBe('Recebida375%');
    expect(items[1]!.textContent).toBe('Entregue125%');
    expect(items[2]!.textContent).toBe('Cancelada00%');
  });

  it('says there is nothing to show instead of drawing an empty bar', () => {
    const { container } = render(<SegmentedBar segments={segments.map((segment) => ({ ...segment, value: 0 }))} caption="Ordens por status" />);
    expect(screen.getByText('Sem registros para exibir.')).toBeTruthy();
    expect(container.querySelector('.segmented-bar')).toBeNull();
  });
});

describe('BarList', () => {
  it('scales bars to the largest value, keeps zero empty and shows the formatted value and hint', () => {
    const { container } = render(<BarList caption="Valores" items={[{ key: 'a', label: 'Maior', value: 200, display: 'R$ 200,00', tone: 'teal', hint: '2 itens' }, { key: 'b', label: 'Metade', value: 100, display: 'R$ 100,00', tone: 'green' }, { key: 'c', label: 'Nada', value: 0, display: 'R$ 0,00', tone: 'violet' }]} />);
    const widths = [...container.querySelectorAll<HTMLElement>('.bar-fill')].map((fill) => fill.style.width);
    expect(widths).toEqual(['100%', '50%', '0%']);
    expect(screen.getByText('R$ 200,00')).toBeTruthy();
    expect(screen.getByText('2 itens')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Valores' })).toBeTruthy();
  });

  it('does not divide by zero when every value is zero', () => {
    const { container } = render(<BarList caption="Valores" items={[{ key: 'a', label: 'A', value: 0, display: 'R$ 0,00', tone: 'teal' }]} />);
    expect((container.querySelector('.bar-fill') as HTMLElement).style.width).toBe('0%');
  });
});
