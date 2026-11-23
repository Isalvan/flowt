import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { clockHeadline, spendingClock, windowLabel } from './spendingClock';

// Datos inventados. En noviembre Madrid va en UTC+1.
let ids = 0;
const madrid = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, day, hour - 1, minute));
const dateOnly = (day: number) => new Date(Date.UTC(2026, 10, day));
const gasto = (fecha: Date, importe = 10, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `g${ids++}`, tipo: 'gasto', concepto: 'Compra', importe, fecha_operacion: fecha, banco: 'Banco A', ...extra,
});

describe('spendingClock', () => {
  it('is empty without expenses', () => {
    const clock = spendingClock([]);
    expect(clock).toMatchObject({ gastos: 0, total: 0, conHora: 0, horasFiables: false, franja: null, diaPico: null, vecesMedia: null });
    expect(clock.horas).toHaveLength(24);
    expect(clock.dias.map(d => d.nombre)).toEqual(['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']);
  });

  it('ignores income, internal moves, transfers and subscriptions, and uses the net amount', () => {
    const clock = spendingClock([
      gasto(madrid(2, 10), 40, { importe_neto: 15 }),
      gasto(madrid(2, 11), 99, { suscripcion_id: 's1' }),
      gasto(madrid(2, 12), 99, { es_interno: true }),
      gasto(madrid(2, 13), 99, { transfer_id: 't1' }),
      { ...gasto(madrid(2, 14), 99), tipo: 'ingreso' },
      gasto(madrid(2, 15), 0),
      gasto('fecha rota' as unknown as Date, 99),
    ]);
    expect(clock.gastos).toBe(1);
    expect(clock.total).toBe(15);
    expect(clock.horas[10]).toEqual({ hora: 10, total: 15, count: 1 });
  });

  it('reads hours in Madrid time and finds the costliest three hours, across midnight', () => {
    const movements = [
      ...Array.from({ length: 6 }, (_, i) => gasto(madrid(3 + i, 23, 30), 20)),
      ...Array.from({ length: 4 }, (_, i) => gasto(madrid(4 + i, 0, 40), 10)), // ya es el día siguiente en Madrid
      ...Array.from({ length: 4 }, (_, i) => gasto(madrid(3 + i, 9, 15 + i), 5)),
    ];
    const clock = spendingClock(movements);
    expect(clock.horasFiables).toBe(true);
    expect(clock.horas[23].count).toBe(6);
    expect(clock.horas[0]).toEqual({ hora: 0, total: 40, count: 4 });
    expect(clock.franja).toMatchObject({ total: 160, count: 10 });
    expect(windowLabel(clock.franja!)).toBe('23:00–01:00');
    expect(clock.franja!.parte).toBeCloseTo(160 / 180);
    expect(clockHeadline(clock)).toBe('Entre las 23:00 y las 01:00 se va el 89 % de lo que gastas');
  });

  it('keeps date-only expenses for weekdays but not for the clock, and hides the clock when few have a time', () => {
    const timed = Array.from({ length: 12 }, (_, i) => gasto(madrid(2 + (i % 7), 19, i), 10));
    const untimed = Array.from({ length: 40 }, (_, i) => gasto(dateOnly(2 + (i % 14)), 10));
    const clock = spendingClock([...timed, ...untimed]);
    expect(clock.gastos).toBe(52);
    expect(clock.conHora).toBe(12);
    expect(clock.horas.reduce((s, h) => s + h.count, 0)).toBe(12);
    expect(clock.horasFiables).toBe(false); // 12 de 52 < 25 %
    expect(clock.franja).toBeNull();
    // Medianoche UTC sigue siendo el mismo día en Madrid.
    expect(clock.dias.reduce((s, d) => s + d.count, 0)).toBe(52);
  });

  it('needs a minimum of expenses with a time', () => {
    const clock = spendingClock(Array.from({ length: 11 }, (_, i) => gasto(madrid(2 + i, 20, i))));
    expect(clock.conHora).toBe(11);
    expect(clock.horasFiables).toBe(false);
  });

  it('averages each weekday over how many of them fall in the range', () => {
    // Del lunes 2 al domingo 15: dos semanas, dos días de cada.
    const movements = [
      gasto(dateOnly(2), 10), gasto(dateOnly(9), 30), // lunes: 40 en 2 lunes
      gasto(dateOnly(7), 60), gasto(dateOnly(14), 100), // sábados: 160 en 2 sábados
      gasto(dateOnly(15), 20), // domingo
    ];
    const clock = spendingClock(movements);
    expect(clock.dias[0]).toMatchObject({ nombre: 'lunes', total: 40, count: 2, dias: 2, media: 20 });
    expect(clock.dias[5]).toMatchObject({ nombre: 'sábado', total: 160, count: 2, dias: 2, media: 80 });
    expect(clock.dias[2]).toMatchObject({ total: 0, dias: 2, media: 0 });
    expect(clock.diaPico?.nombre).toBe('sábado');
    // Media de los siete días: (20 + 80 + 10) / 7.
    expect(clock.vecesMedia).toBe(5.1);
    expect(clockHeadline(clock)).toBe('Los sábados gastas 5,1 veces lo de un día normal');
  });

  it('has no peak day with a single day of data', () => {
    const clock = spendingClock([gasto(dateOnly(4), 10), gasto(dateOnly(4), 5)]);
    expect(clock.diaPico).toBeNull();
    expect(clockHeadline(clock)).toBe('Así se reparte tu gasto en la semana');
  });

  it('ignores the time of a bank that sends its notices in batches', () => {
    const batch = Array.from({ length: 8 }, (_, i) => gasto(madrid(2 + i, 6, 0), 10, { banco: 'Banco Lote' }));
    const real = Array.from({ length: 14 }, (_, i) => gasto(madrid(2 + (i % 10), 13 + (i % 4), i * 3), 10));
    const clock = spendingClock([...batch, ...real]);
    expect(clock.bancosPorLotes).toEqual(['Banco Lote']);
    expect(clock.conHora).toBe(14);
    expect(clock.horas[6].count).toBe(0);
    expect(clock.gastos).toBe(22);
  });

  it('keeps a bank whose times vary', () => {
    const clock = spendingClock(Array.from({ length: 12 }, (_, i) => gasto(madrid(2 + i, 8 + i, i), 10)));
    expect(clock.bancosPorLotes).toEqual([]);
    expect(clock.horasFiables).toBe(true);
  });
});
