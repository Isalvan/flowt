import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento, Suscripcion } from '../types';
import { detectNewSubscriptions, detectPriceChanges } from './recurringCharges';

const today = new Date(2026, 2, 20);
const expense = (date: string, overrides: Partial<Movimiento> = {}): Movimiento => ({
  id: date, tipo: 'gasto', concepto: 'Gimnasio X', importe: 29.9, fecha_operacion: date,
  categoria: 'salud', ...overrides,
});
const history = () => ['2026-01-12', '2026-02-15', '2026-03-10'].map(date => expense(date));
const subscription = (overrides: Partial<Suscripcion> = {}): Suscripcion => ({
  id: 'netflix', nombre: 'Netflix', importe: 12.99, frecuencia: 'mensual', dia_pago: 10,
  categoria: 'ocio', color: '#000000', activa: true, ...overrides,
});
afterEach(() => vi.useRealTimers());

describe('detectNewSubscriptions', () => {
  it('detecta tres meses con días variables, con campos completos y sin mutar', () => {
    const movements = history().reverse();
    expect(detectNewSubscriptions(movements, [], today)).toEqual([{
      key: 'gimnasio x', nombre: 'Gimnasio X', importe: 29.9, dia_pago: 10,
      fecha_inicio: '2026-03-10', categoria: 'salud',
      movimientoIds: ['2026-01-12', '2026-02-15', '2026-03-10'], meses: 3,
    }]);
    expect(movements[0].id).toBe('2026-03-10');
  });
  it('no detecta solo dos meses', () => expect(detectNewSubscriptions(history().slice(1), [], today)).toEqual([]));
  it('no detecta meses no consecutivos', () => expect(detectNewSubscriptions([
    expense('2025-11-10'), expense('2026-01-10'), expense('2026-03-10'),
  ], [], today)).toEqual([]));
  it('admite diciembre a enero y fechas locales Date y Timestamp', () => {
    expect(detectNewSubscriptions([
      expense('a', { fecha_operacion: new Date(2025, 11, 31) }),
      expense('b', { fecha_operacion: { toDate: () => new Date(2026, 0, 30) } }),
      expense('c', { fecha_operacion: new Date(2026, 1, 28) }),
    ], [], today)[0]).toMatchObject({ meses: 3, fecha_inicio: '2026-02-28', dia_pago: 28 });
  });
  it('ignora el precio de cobros antiguos fuera de la racha actual', () => {
    expect(detectNewSubscriptions([
      expense('2025-09-10', { importe: 15 }), expense('2025-10-10', { importe: 15 }),
      ...history(),
    ], [], today)[0]).toMatchObject({ importe: 29.9, meses: 3 });
  });
  it('rechaza variación del 40 %', () => {
    const movements = history();
    movements[2].importe *= 1.4;
    expect(detectNewSubscriptions(movements, [], today)).toEqual([]);
  });
  it('admite tolerancia de 1 euro para pequeños importes', () => {
    expect(detectNewSubscriptions(history().map((m, i) => ({ ...m, importe: [2, 2.8, 2][i] })), [], today)).toHaveLength(1);
  });
  it('rechaza dos cobros en el mismo mes, incluso fuera de la racha reciente', () => {
    expect(detectNewSubscriptions([...history(), expense('2026-02-22')], [], today)).toEqual([]);
  });
  it.each([
    { suscripcion_id: 'existing' }, { es_interno: true }, { transfer_id: 'transfer' },
    { es_metalico: true }, { tipo: 'ingreso' as const }, { importe: 0 }, { importe: -1 },
    { importe: Number.NaN }, { importe: Number.POSITIVE_INFINITY }, { fecha_operacion: 'invalid' },
  ])('excluye movimientos no válidos: %j', overrides => {
    expect(detectNewSubscriptions(history().map(m => ({ ...m, ...overrides })), [], today)).toEqual([]);
  });
  it('excluye suscripciones existentes por nombre y alias', () => {
    expect(detectNewSubscriptions(history(), [subscription({ nombre: 'Gimnasio X' })], today)).toEqual([]);
    expect(detectNewSubscriptions(history().map(m => ({ ...m, concepto: 'OPENAI 1234' })), [subscription({ nombre: 'ChatGPT' })], today)).toEqual([]);
  });
  it('rechaza último cobro hace sesenta días', () => {
    expect(detectNewSubscriptions(['2025-11-19', '2025-12-19', '2026-01-19'].map(d => expense(d)), [], today)).toEqual([]);
  });
  it('limpia referencias y usa la categoría más frecuente; ordena por coste anual', () => {
    const movements = history().map((m, i) => ({ ...m, concepto: `Gimnasio X REF: ABC${i}99`, categoria: i === 2 ? 'otros' : 'salud' }));
    const other = history().map(m => ({ ...m, id: `other:${m.id}`, concepto: 'Spotify AB123', importe: 40, categoria: undefined }));
    expect(detectNewSubscriptions([...movements, ...other], [], today)).toMatchObject([
      { key: 'spotify', nombre: 'Spotify', categoria: 'otros' },
      { key: 'gimnasio x', nombre: 'Gimnasio X', categoria: 'salud' },
    ]);
  });
  it('excluye claves cortas y cargos futuros', () => {
    expect(detectNewSubscriptions(history().map(m => ({ ...m, concepto: 'ABC 123' })), [], today)).toEqual([]);
    expect(detectNewSubscriptions(['2026-04-01', '2026-05-01', '2026-06-01'].map(d => expense(d)), [], today)).toEqual([]);
  });
});

describe('detectPriceChanges', () => {
  const charge = (overrides: Partial<Movimiento> = {}) => expense('2026-03-10', { concepto: 'NETFLIX 123', importe: 13.99, ...overrides });
  it.each([{}, { suscripcion_id: 'netflix', concepto: 'otro concepto' }])('detecta por nombre o vínculo: %j', overrides => {
    expect(detectPriceChanges([charge(overrides)], [subscription()])).toEqual([{
      suscripcionId: 'netflix', nombre: 'Netflix', importeAnterior: 12.99, importeNuevo: 13.99,
      movimientoId: '2026-03-10', fecha: '2026-03-10', diferenciaMensual: 1, diferenciaAnual: 12,
    }]);
  });
  it('compara el total, sin usar mi_parte', () => {
    expect(detectPriceChanges([charge()], [subscription({ mi_parte: 3 })])[0]?.importeAnterior).toBe(12.99);
    expect(detectPriceChanges([charge({ importe: 12.99 })], [subscription({ mi_parte: 3 })])).toEqual([]);
  });
  it('reconoce referencias bancarias de servicios sin alias después de darlos de alta', () => {
    expect(detectPriceChanges([charge({ concepto: 'Gimnasio X REF: AB123', importe: 32 })], [
      subscription({ nombre: 'Gimnasio X', importe: 29.9 }),
    ])[0]).toMatchObject({ nombre: 'Gimnasio X', importeNuevo: 32 });
  });
  it.each([10, 13.29, 13.49])('no avisa de bajadas ni pequeñas subidas (%s)', importe => {
    expect(detectPriceChanges([charge({ importe })], [subscription()])).toEqual([]);
  });
  it('exige más del 2 % para importes altos', () => {
    expect(detectPriceChanges([charge({ importe: 102 })], [subscription({ importe: 100 })])).toEqual([]);
  });
  it.each([['mensual', 12], ['trimestral', 4], ['semestral', 2], ['anual', 1]] as const)('anualiza la frecuencia %s', (frecuencia, annual) => {
    expect(detectPriceChanges([charge()], [subscription({ frecuencia })])[0]).toMatchObject({ diferenciaAnual: annual, diferenciaMensual: annual / 12 });
  });
  it('da prioridad a los vinculados y al último cobro', () => {
    expect(detectPriceChanges([
      charge({ importe: 20 }), charge({ id: 'linked', suscripcion_id: 'netflix', importe: 12.99, fecha_operacion: '2026-02-10' }),
    ], [subscription()])).toEqual([]);
    expect(detectPriceChanges([charge(), charge({ id: 'latest', importe: 12.99, fecha_operacion: '2026-04-10' })], [subscription()])).toEqual([]);
  });
  it('excluye pausadas, canceladas vencidas, transferencias y vinculadas a otra suscripción', () => {
    vi.useFakeTimers(); vi.setSystemTime(today);
    expect(detectPriceChanges([charge()], [subscription({ activa: false })])).toEqual([]);
    expect(detectPriceChanges([charge()], [subscription({ cancel_at: '2026-03-20' })])).toEqual([]);
    expect(detectPriceChanges([charge()], [subscription({ cancel_at: '2026-04-20' })])).toHaveLength(1);
    expect(detectPriceChanges([charge({ es_interno: true })], [subscription()])).toEqual([]);
    expect(detectPriceChanges([charge({ suscripcion_id: 'other' })], [subscription()])).toEqual([]);
  });
});
