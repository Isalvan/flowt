import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { buildMoneyFlow } from './moneyFlow';
import { walletAccent } from './walletAccent';

const movement = (tipo: Movimiento['tipo'], importe: number, categoria?: string, extra: Partial<Movimiento> = {}): Movimiento =>
  ({ id: `${tipo}-${categoria}`, tipo, importe, categoria, concepto: 'Private concept', fecha_operacion: new Date(), ...extra });
const build = (movements: Movimiento[]) => buildMoneyFlow(movements, m => m.categoria, id => id);

describe('buildMoneyFlow', () => {
  it('routes payroll alone to unspent income', () => {
    expect(build([movement('ingreso', 100, 'nomina')])).toMatchObject({ total: 100,
      sources: [{ id: 'nomina', label: 'Nómina', amount: 100, percent: 100, color: null }],
      destinations: [{ id: 'sin_gastar', amount: 100, percent: 100, color: null }],
    });
  });
  it('separates payroll and other income', () => {
    expect(build([movement('ingreso', 75, 'nomina'), movement('ingreso', 25)])?.sources.map(item => [item.id, item.percent]))
      .toEqual([['nomina', 75], ['otros_ingresos', 25]]);
  });
  it('adds savings when spending exceeds income', () => {
    const flow = build([movement('ingreso', 10), movement('gasto', 30)]);
    expect(flow?.sources.at(-1)).toMatchObject({ id: 'ahorrado', amount: 20 });
    expect(flow?.destinations).toEqual([expect.objectContaining({ id: 'sin_categoria', label: 'Sin categoría', percent: 100 })]);
    expect(flow?.total).toBe(30);
  });
  it('keeps six categories in descending order and groups the rest, like the category chart', () => {
    const flow = build(Array.from({ length: 8 }, (_, i) => movement('gasto', i + 1, `c${i}`)));
    expect(flow?.destinations.map(item => item.id)).toEqual(['c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'otras']);
    expect(flow?.destinations.map(item => item.color)).toEqual([0, 1, 2, 3, 4, 5, 6].map(i => walletAccent(i).hex));
    expect(flow?.destinations.at(-1)).toMatchObject({ amount: 3 });
  });
  it('sums to exactly 100 per side and gives tiny items at least one percent', () => {
    const flow = build([movement('ingreso', 1000, 'nomina'), movement('ingreso', 0.01),
      movement('gasto', 0.01, 'tiny'), movement('gasto', 333, 'a'), movement('gasto', 333, 'b')])!;
    for (const items of [flow.sources, flow.destinations]) {
      expect(items.reduce((sum, item) => sum + item.percent, 0)).toBe(100);
      expect(items.every(item => item.percent >= 1)).toBe(true);
    }
    expect(flow.sources[1].percent).toBe(1);
    expect(flow.destinations.find(item => item.id === 'tiny')?.percent).toBe(1);
  });
  it('returns null for empty data and excludes internal transfers', () => {
    expect(build([])).toBeNull();
    expect(build([movement('ingreso', 100, undefined, { es_interno: true }),
      movement('gasto', 100, undefined, { transfer_id: 'transfer' })])).toBeNull();
  });
  it('subtracts compensations and sums individually rounded cents', () => {
    const flow = build([movement('ingreso', 10, undefined, { compensaciones_destinos: [{ gasto_id: 'a', importe: 2 }] }),
      movement('gasto', 10, 'a', { importe_neto: 8 }), movement('gasto', 1, 'b', { importe_neto: 0.104 }),
      movement('gasto', 1, 'b', { importe_neto: 0.104 })])!;
    expect(flow.total).toBe(8.2);
    expect(flow.sources[0].amount).toBe(8);
    expect(flow.destinations[1].amount).toBe(0.2);
  });
});
