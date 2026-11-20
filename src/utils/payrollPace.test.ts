import { describe, expect, it } from 'vitest';
import type { Hucha, Movimiento } from '../types';
import { payrollCycles, payrollPace } from './payrollPace';
import { payrollSummary } from './payrollSummary';

// Fictitious figures: every payroll leaves 1000 free, so 10 spent is 1 %.
const huchas: Hucha[] = [
  { id: 'free', nombre: 'Día a día', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 0, objetivo: null, orden: 0 },
  { id: 'save', nombre: 'Ahorros', tipo_aportacion: 'porcentaje', valor_aportacion: 50, saldo_acumulado: 0, objetivo: null, orden: 1 },
];
let ids = 0;
const payroll = (fecha: Date, libre = 1000, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `pay${ids++}`, tipo: 'ingreso', concepto: 'Nómina', categoria: 'nomina', importe: 2000, fecha_operacion: fecha,
  reparto_aplicado: { saldos: { free: libre, save: 2000 - libre }, deudas: {} }, ...extra,
});
const expense = (fecha: Date, importe = 10, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `exp${ids++}`, tipo: 'gasto', concepto: 'Compra', importe, fecha_operacion: fecha, ...extra,
});
/** One expense of `importe` on each of the first `days` days of the cycle that starts on `start`. */
const daily = (start: Date, days: number, importe = 10) => Array.from({ length: days }, (_, day) =>
  expense(new Date(start.getFullYear(), start.getMonth(), start.getDate() + day, 12), importe));
const starts = [new Date(2026, 4, 28), new Date(2026, 5, 28), new Date(2026, 6, 28), new Date(2026, 7, 28), new Date(2026, 8, 28)];

describe('payrollPace', () => {
  it('returns null without a past payroll', () => {
    expect(payrollPace([], huchas, new Date(2026, 9, 1))).toBeNull();
    expect(payrollPace([expense(new Date(2026, 8, 1)), payroll(new Date(2026, 11, 1))], huchas, new Date(2026, 9, 1))).toBeNull();
  });

  it('has no ghost with fewer than two earlier cycles', () => {
    const pace = payrollPace([payroll(starts[3]), payroll(starts[4]), ...daily(starts[3], 20)], huchas, new Date(2026, 9, 3, 18))!;
    expect(pace.ciclos).toBe(1);
    expect(pace.fantasmaHoy).toBeNull();
    expect(pace.diasDeVentaja).toBeNull();
    expect(pace.puntos.every(point => point.fantasma === undefined)).toBe(true);
    expect(pace.puntos).toHaveLength(6);
  });

  it('aligns cycles by days since payroll, with the median and the full range under four cycles', () => {
    const movements = [
      ...starts.slice(1).map(start => payroll(start)),
      expense(new Date(2026, 5, 29, 9), 100), expense(new Date(2026, 6, 29, 9), 200), expense(new Date(2026, 7, 29, 9), 300),
    ];
    const pace = payrollPace(movements, huchas, new Date(2026, 9, 3, 18))!;
    expect(pace.ciclos).toBe(3);
    expect(pace.unidad).toBe('porcentaje');
    expect(pace.puntos[0]).toMatchObject({ dia: 0, actual: 0, fantasma: 0, banda: [0, 0] });
    expect(pace.puntos[1]).toMatchObject({ fantasma: 20, banda: [10, 30] });
    expect(pace.puntos[5]).toMatchObject({ dia: 5, actual: 0, actualImporte: 0, fantasma: 20 });
    // The ghost stops when fewer than two cycles are that long: two cycles have 31 days.
    expect(pace.puntos.at(-1)!.dia).toBe(30);
  });

  it('uses the quartiles with four or more cycles', () => {
    const movements = [
      ...starts.map(start => payroll(start)),
      ...[100, 200, 300, 400].map((amount, index) => expense(new Date(starts[index].getTime() + 86_400_000), amount)),
    ];
    const pace = payrollPace(movements, huchas, new Date(2026, 9, 3))!;
    expect(pace.ciclos).toBe(4);
    expect(pace.puntos[1]).toMatchObject({ fantasma: 25, banda: [17.5, 32.5] });
  });

  it('keeps only the most recent cycles', () => {
    const movements = [...starts.map(start => payroll(start)), ...starts.slice(0, 4).flatMap(start => daily(start, 20))];
    expect(payrollPace(movements, huchas, new Date(2026, 9, 3), { maxCycles: 2 })!.ciclos).toBe(2);
  });

  it('counts the days ahead or behind the usual pace', () => {
    const history = [...starts.map(start => payroll(start)), ...starts.slice(0, 4).flatMap(start => daily(start, 28))];
    const now = new Date(2026, 9, 3, 18); // Day 5 of the current cycle; the ghost has spent 6 %.
    const slow = payrollPace([...history, ...daily(starts[4], 3)], huchas, now)!;
    expect(slow).toMatchObject({ hoy: 5, actual: 3, fantasmaHoy: 6, diasDeVentaja: 3, alMenos: false, gastado: 30 });
    const fast = payrollPace([...history, ...daily(starts[4], 6), expense(new Date(2026, 9, 3, 9), 20)], huchas, now)!;
    expect(fast).toMatchObject({ actual: 8, diasDeVentaja: -2 });
    const even = payrollPace([...history, ...daily(starts[4], 6)], huchas, now)!;
    expect(even.diasDeVentaja).toBe(0);
    const quiet = payrollPace(history, huchas, now)!;
    expect(quiet).toMatchObject({ actual: 0, diasDeVentaja: 5, alMenos: true });
  });

  it('has no lead on payroll day', () => {
    const history = [...starts.map(start => payroll(start)), ...starts.slice(0, 4).flatMap(start => daily(start, 28))];
    const pace = payrollPace(history, huchas, new Date(2026, 8, 28, 20))!;
    expect(pace.hoy).toBe(0);
    expect(pace.diasDeVentaja).toBeNull();
  });

  it('matches what payrollSummary counts as spent, nets refunds and leaves out other wallets', () => {
    const movements = [
      ...starts.map(start => payroll(start)), ...starts.slice(0, 4).flatMap(start => daily(start, 10)),
      expense(new Date(2026, 8, 29), 50, { importe_neto: 30 }),
      expense(new Date(2026, 8, 30), 70, { hucha_id: 'save' }),
      expense(new Date(2026, 8, 30), 40, { es_interno: true }),
    ];
    const now = new Date(2026, 9, 2, 12);
    const pace = payrollPace(movements, huchas, now)!;
    expect(pace.gastado).toBe(30);
    expect(pace.gastado).toBe(payrollSummary(movements, huchas, [], now)!.gastado);
    expect(pace.libre).toBe(payrollSummary(movements, huchas, [], now)!.libre);
  });

  it('leaves out cycles with no free part, and compares in euros when the current one has none', () => {
    const movements = [
      payroll(starts[0]), payroll(starts[1], 0), payroll(starts[2]), payroll(starts[3]), payroll(starts[4]),
      ...starts.slice(0, 4).flatMap(start => daily(start, 10)),
    ];
    expect(payrollPace(movements, huchas, new Date(2026, 9, 3))!.ciclos).toBe(3);
    const noFree = movements.map(movement => movement.fecha_operacion === starts[4] ? payroll(starts[4], 0) : movement);
    const pace = payrollPace(noFree, huchas, new Date(2026, 9, 3))!;
    expect(pace).toMatchObject({ unidad: 'euros', ciclos: 4 });
    expect(pace.puntos[2].fantasma).toBe(30);
  });

  it('flags cycles whose split used the current rules', () => {
    const movements = [payroll(starts[2], 1000, { reparto_aplicado: undefined }), payroll(starts[3]), payroll(starts[4])];
    const pace = payrollPace(movements, huchas, new Date(2026, 9, 3))!;
    expect(pace.ciclos).toBe(2);
    expect(pace.reglasActuales).toBe(true);
  });
});

describe('payrollCycles', () => {
  it('joins a short cycle, such as an extra payment, to the cycle before it', () => {
    const movements = [
      payroll(new Date(2026, 5, 28)), payroll(new Date(2026, 6, 23), 500), payroll(new Date(2026, 6, 28)), payroll(new Date(2026, 7, 28)),
      expense(new Date(2026, 6, 25), 40),
    ];
    const cycles = payrollCycles(movements, huchas, new Date(2026, 8, 1));
    expect(cycles.map(({ start, end, libre }) => ({ start, end, libre }))).toEqual([
      { start: new Date(2026, 5, 28), end: new Date(2026, 6, 28), libre: 1500 },
      { start: new Date(2026, 6, 28), end: new Date(2026, 7, 28), libre: 1000 },
    ]);
    expect(cycles[0].acumulado).toHaveLength(30);
    expect(cycles[0].acumulado[27]).toBe(40);
  });

  it('drops a short first cycle and leaves a cycle with a missing payroll out of the comparison', () => {
    const movements = [
      payroll(new Date(2026, 0, 20)), payroll(new Date(2026, 0, 28)), payroll(new Date(2026, 2, 28)),
      payroll(new Date(2026, 3, 28)), payroll(new Date(2026, 4, 28)),
    ];
    expect(payrollCycles(movements, huchas, new Date(2026, 5, 1)).map(cycle => cycle.start)).toEqual([
      new Date(2026, 0, 28), new Date(2026, 2, 28), new Date(2026, 3, 28),
    ]);
    expect(payrollPace(movements, huchas, new Date(2026, 5, 1))!.ciclos).toBe(2);
  });

  it('counts calendar days across a daylight saving change', () => {
    // Europe moves its clocks on 25 October 2026 and 29 March 2026.
    const movements = [
      payroll(new Date(2026, 1, 28)), payroll(new Date(2026, 2, 28)), payroll(new Date(2026, 8, 28)), payroll(new Date(2026, 9, 28)),
      expense(new Date(2026, 9, 26, 0, 30), 10), expense(new Date(2026, 2, 30, 0, 30), 10),
    ];
    const cycles = payrollCycles(movements, huchas, new Date(2026, 10, 1));
    expect(cycles[1].acumulado.indexOf(10)).toBe(2);
    expect(cycles.at(-1)!.acumulado).toHaveLength(30);
    expect(cycles.at(-1)!.acumulado.indexOf(10)).toBe(28);
  });
});
