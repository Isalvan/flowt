import { describe, expect, it } from 'vitest';
import type { Movimiento, Suscripcion } from '../types';
import { yearEcho } from './yearEcho';

// Fictitious figures only.
let ids = 0;
const expense = (fecha: Date, concepto: string, importe: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `m${ids++}`, tipo: 'gasto', concepto, importe, fecha_operacion: fecha, ...extra,
});
const today = new Date(2026, 10, 20, 18);
/** A small coffee every week for 14 months, so the history covers last year's window. */
const routine = () => Array.from({ length: 62 }, (_, week) => expense(new Date(2025, 8, 15 + week * 7), 'Cafetería Sol', 3));

describe('yearEcho', () => {
  it('needs a history that reaches last year', () => {
    expect(yearEcho([], [], today)).toBeNull();
    expect(yearEcho([expense(new Date(2026, 2, 1), 'Cafetería Sol', 3)], [], today)).toBeNull();
  });

  it('brings back a yearly charge on the same date, flagging it before payroll', () => {
    const echo = yearEcho([...routine(), expense(new Date(2025, 11, 2), 'Seguro Hogar Atlas 9921', 240, { categoria: 'hogar' })], [], today,
      { proximaNomina: new Date(2026, 11, 28) })!;
    expect(echo.items).toHaveLength(1);
    const [item] = echo.items;
    expect(item).toMatchObject({ tipo: 'anual', key: 'seguro hogar atlas', importe: 240, dias: 12, antesDeNomina: true, pagado: null, categoria: 'hogar' });
    expect(item.fecha).toEqual(new Date(2026, 11, 2));
    expect(echo.pendiente).toBe(240);
  });

  it('marks a yearly charge already paid this year and leaves it out of the pending total', () => {
    const echo = yearEcho([
      ...routine(),
      expense(new Date(2025, 11, 10), 'ITV Norte', 45),
      expense(new Date(2026, 10, 3), 'ITV Norte', 48),
    ], [], today)!;
    expect(echo.items[0].pagado).toEqual({ fecha: new Date(2026, 10, 3), importe: 48 });
    expect(echo.pendiente).toBe(0);
  });

  it('ignores small one-offs, subscriptions, internal moves and anything outside the window', () => {
    const subs: Suscripcion[] = [{ id: 's', nombre: 'Gimnasio Forma', importe: 300, frecuencia: 'anual', dia_pago: 1, categoria: 'deporte', color: '#000', activa: true }];
    const echo = yearEcho([
      ...routine(),
      expense(new Date(2025, 11, 1), 'Librería Mar', 12),
      expense(new Date(2025, 11, 1), 'Gimnasio Forma anual', 300),
      expense(new Date(2025, 11, 1), 'Otra cuenta', 500, { es_interno: true }),
      expense(new Date(2025, 11, 1), 'Cuota club', 500, { suscripcion_id: 'x' }),
      expense(new Date(2026, 1, 15), 'Seguro Coche Vía', 400),
      expense(new Date(2025, 10, 10), 'Concierto Arena', 90),
    ], subs, today)!;
    expect(echo.items).toEqual([]);
    expect(echo.pendiente).toBe(0);
  });

  it('skips usual merchants unless that season they doubled their normal spend', () => {
    const monthly = (concepto: string, importe: number) => Array.from({ length: 14 }, (_, month) => expense(new Date(2025, 8 + month, 5), concepto, importe));
    const echo = yearEcho([
      ...routine(),
      ...monthly('Supermercado Luna', 80),
      expense(new Date(2025, 11, 20), 'Supermercado Luna', 40),
      ...monthly('Tienda Online Nube', 30),
      expense(new Date(2025, 11, 15), 'Tienda Online Nube', 150),
      expense(new Date(2025, 11, 18), 'Tienda Online Nube 4421 ref 99', 120),
    ], [], today)!;
    expect(echo.items.map(item => item.key)).toEqual(['tienda online nube']);
    const [spike] = echo.items;
    expect(spike.tipo).toBe('pico');
    expect(spike.fecha).toEqual(new Date(2026, 11, 5));
    expect(spike.veces).toBeGreaterThan(2);
    // 300 € that season against a usual ~1 € a day over those 45 days.
    expect(spike.importe).toBeGreaterThan(240);
    expect(spike.importe).toBeLessThan(270);
  });

  it('caps the bar for out of the ordinary when everyday spending is high', () => {
    const big = Array.from({ length: 14 }, (_, month) => expense(new Date(2025, 8 + month, 3), 'Hipermercado Gran', 200));
    const echo = yearEcho([...big, ...big, expense(new Date(2025, 11, 1), 'Óptica Clara', 160)], [], today)!;
    expect(echo.items.map(item => item.nombre)).toEqual(['Óptica Clara']);
  });

  it('uses the net amount after refunds and keeps the biggest ones, ordered by date', () => {
    const echo = yearEcho([
      ...routine(),
      expense(new Date(2025, 11, 22), 'Joyería Brillo', 200, { importe_neto: 20 }),
      ...['Alfa', 'Beta', 'Gamma', 'Delta'].map((name, i) => expense(new Date(2025, 11, 28 - i), `Regalo ${name}`, 50 + i * 10)),
    ], [], today, { max: 3 })!;
    expect(echo.items.map(item => item.nombre)).toEqual(['Regalo Delta', 'Regalo Gamma', 'Regalo Beta']);
    expect(echo.pendiente).toBe(210);
  });
});
