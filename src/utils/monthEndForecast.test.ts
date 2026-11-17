import { describe, expect, it, vi } from 'vitest';
import type { Hucha, Movimiento, Suscripcion } from '../types';
import { forecastMonthEnd } from './monthEndForecast';
import * as incomeSplit from './incomeSplit';

const now = new Date(2026, 10, 20, 12);
const wallet = (id: string, extra: Partial<Hucha> = {}): Hucha => ({
  id, nombre: id, saldo_acumulado: 1000, objetivo: null, tipo_aportacion: 'resto', orden: 1, ...extra,
});
const movement = (id: string, importe: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, concepto: id, tipo: 'gasto', importe, fecha_operacion: new Date(2026, 10, 1), ...extra,
});
const subscription = (id: string, extra: Partial<Suscripcion> = {}): Suscripcion => ({
  id, nombre: id, importe: 20, frecuencia: 'mensual', dia_pago: 25,
  categoria: 'otros', color: 'blue', activa: true, ...extra,
});

describe('forecastMonthEnd', () => {
  it('calcula el ritmo por cartera y atribuye destinos ausentes o inactivos a la principal', () => {
    const huchas = [wallet('resto'), wallet('principal', { es_principal: true }), wallet('otra'), wallet('inactiva', { activa: false })];
    const movimientos = [
      movement('propio', 200, { hucha_id: 'otra', importe_neto: 100 }),
      movement('desconocida', 40, { hucha_id: 'inexistente' }),
      movement('inactiva', 40, { hucha_id: 'inactiva' }),
      movement('sin destino', 20),
      movement('interno', 999, { es_interno: true }),
      movement('futuro', 999, { fecha_operacion: new Date(2026, 10, 21) }),
      movement('invalido', 999, { fecha_operacion: 'invalida' }),
    ];
    const result = forecastMonthEnd(huchas, movimientos, [], now);
    expect(Object.keys(result)).toEqual(['resto', 'principal', 'otra']);
    expect(result.principal).toEqual({ previsto: 950, gastoVariable: 50, suscripciones: 0, ingresos: 0, diasRestantes: 10, sinHistorial: false });
    expect(result.otra.gastoVariable).toBe(50);
    expect(result.resto.previsto).toBe(1000);
  });

  it.each([false, true])('usa resto o primera activa como destino por defecto (sin resto: %s)', sinResto => {
    const huchas = [wallet('primera', { tipo_aportacion: 'flat' }), wallet('segunda', { tipo_aportacion: sinResto ? 'flat' : 'resto' })];
    const result = forecastMonthEnd(huchas, [movement('gasto', 100)], [], now);
    expect(result[sinResto ? 'primera' : 'segunda'].gastoVariable).toBe(50);
  });

  it('limita el historial a 90 días incluyendo hoy y el primer día de la ventana', () => {
    const movimientos = [
      movement('antiguo', 9000, { fecha_operacion: new Date(2026, 7, 22) }),
      movement('limite', 450, { fecha_operacion: { toDate: () => new Date(2026, 7, 23) } }),
      movement('hoy', 450, { fecha_operacion: new Date(2026, 10, 20, 23) }),
    ];
    expect(forecastMonthEnd([wallet('a')], movimientos, [], now).a.gastoVariable).toBe(100);
  });

  it('excluye suscripciones por id, nombre y cartera del ritmo variable', () => {
    const movimientos = [
      movement('normal', 100),
      movement('por id', 100, { suscripcion_id: 's' }),
      movement('por nombre', 100, { concepto: 'Spotify premium' }),
      movement('por cartera', 100, { hucha_id: 'subs' }),
    ];
    const result = forecastMonthEnd([wallet('a'), wallet('subs', { es_suscripciones: true })], movimientos,
      [subscription('Spotify', { dia_pago: 1 })], now);
    expect(result.a.gastoVariable).toBe(50);
    expect(result.subs.gastoVariable).toBe(0);
  });

  it('suma solo cobros futuros activos, respetando bajas, ciclos y mi_parte', () => {
    const result = forecastMonthEnd([wallet('a')], [], [
      subscription('pendiente', { mi_parte: 7.5 }),
      subscription('cobrada', { dia_pago: 19 }),
      subscription('hoy', { dia_pago: 20 }),
      subscription('inactiva', { activa: false }),
      subscription('baja antes', { cancel_at: '2026-11-24' }),
      subscription('baja el cobro', { cancel_at: '2026-11-25' }),
      subscription('baja después', { cancel_at: '2026-11-26', importe: 5 }),
      subscription('anual otro mes', { frecuencia: 'anual', fecha_inicio: '2026-10-25' }),
    ], now);
    expect(result.a.suscripciones).toBe(12.5);
    expect(result.a.previsto).toBe(987.5);
  });

  it('enruta suscripciones a su cartera activa o a la de suscripciones', () => {
    const result = forecastMonthEnd([wallet('a'), wallet('subs', { es_suscripciones: true }), wallet('inactiva', { activa: false })], [], [
      subscription('dirigida', { hucha_id: 'a' }),
      subscription('sin cartera'),
      subscription('destino inexistente', { hucha_id: 'no existe' }),
      subscription('destino inactivo', { hucha_id: 'inactiva' }),
    ], now);
    expect(result.a.suscripciones).toBe(20);
    expect(result.subs.suscripciones).toBe(60);
  });

  it('reparte nómina pendiente con cantidades fijas, porcentajes y extra del mes', () => {
    const huchas = [
      wallet('fija', { tipo_aportacion: 'flat', valor_aportacion: 100, extra_importe: 50, extra_meses: [11] }),
      wallet('porcentaje', { tipo_aportacion: 'porcentaje', valor_aportacion: 20 }),
      wallet('resto'),
      wallet('inactiva', { activa: false, tipo_aportacion: 'flat', valor_aportacion: 500 }),
    ];
    const nomina = movement('nómina', 1000, { tipo: 'ingreso', categoria: 'nomina', fecha_operacion: new Date(2026, 9, 25) });
    const result = forecastMonthEnd(huchas, [nomina], [], now);
    expect(result.fija.ingresos).toBe(150);
    expect(result.porcentaje.ingresos).toBe(200);
    expect(result.resto.ingresos).toBe(650);
    expect(result.resto.previsto).toBe(1650);
  });

  it('no añade nómina ya recibida este mes ni una prevista para hoy', () => {
    const nomina = movement('nómina', 1000, { tipo: 'ingreso', categoria: 'nomina', fecha_operacion: new Date(2026, 9, 25) });
    const cobrada = { ...nomina, id: 'actual', fecha_operacion: new Date(2026, 10, 5) };
    expect(forecastMonthEnd([wallet('a')], [nomina, cobrada], [], now).a.ingresos).toBe(0);
    expect(forecastMonthEnd([wallet('a')], [nomina], [], new Date(2026, 10, 25)).a.ingresos).toBe(0);
  });

  it('limita la nómina al último día de un mes corto', () => {
    const nomina = movement('nómina', 1000, { tipo: 'ingreso', categoria: 'nomina', fecha_operacion: new Date(2026, 9, 31) });
    expect(forecastMonthEnd([wallet('a')], [nomina], [], new Date(2026, 10, 29)).a.ingresos).toBe(1000);
  });

  it('ignora errores de reparto conocidos y relanza los inesperados', () => {
    const nomina = movement('nómina', 1000, { tipo: 'ingreso', categoria: 'nomina', fecha_operacion: new Date(2026, 9, 25) });
    const spy = vi.spyOn(incomeSplit, 'splitIncome');
    try {
      spy.mockImplementation(() => { throw Object.assign(new Error('Reparto inválido'), { code: 'invalid_distribution' }); });
      expect(forecastMonthEnd([wallet('a')], [nomina], [], now).a.ingresos).toBe(0);
      spy.mockImplementation(() => { throw new Error('inesperado'); });
      expect(() => forecastMonthEnd([wallet('a')], [nomina], [], now)).toThrow('inesperado');
    } finally {
      spy.mockRestore();
    }
  });

  it('el último día del mes mantiene el saldo actual', () => {
    const result = forecastMonthEnd([wallet('a')], [movement('gasto', 100)], [subscription('subs', { dia_pago: 30 })], new Date(2026, 10, 30));
    expect(result.a).toMatchObject({ previsto: 1000, diasRestantes: 0, gastoVariable: 0, suscripciones: 0, ingresos: 0 });
  });

  it('marca historial insuficiente con menos de 14 días, pero acepta exactamente 14', () => {
    const corto = movement('gasto', 140, { fecha_operacion: new Date(2026, 10, 8) });
    expect(forecastMonthEnd([wallet('a')], [corto], [], now).a).toMatchObject({ sinHistorial: true, gastoVariable: 0 });
    const suficiente = { ...corto, fecha_operacion: new Date(2026, 10, 7) };
    expect(forecastMonthEnd([wallet('a')], [suficiente], [], now).a).toMatchObject({ sinHistorial: false, gastoVariable: 100 });
    expect(forecastMonthEnd([wallet('a')], [], [], now).a.sinHistorial).toBe(true);
    expect(forecastMonthEnd([], [suficiente], [], now)).toEqual({});
  });

  it('las bajas antiguas sin fecha usan now y no el reloj del sistema', () => {
    const s = subscription('cancelando', { cancelando: true });
    const input = structuredClone(s);
    expect(forecastMonthEnd([wallet('a')], [], [s], now).a.suscripciones).toBe(0);
    expect(s).toEqual(input);
  });

  it('cuenta días naturales al cruzar el cambio de hora y redondea a céntimos', () => {
    const fecha = new Date(2026, 2, 20, 12);
    const movimientos = [movement('gasto', 1, { fecha_operacion: new Date(2026, 2, 1) })];
    const result = forecastMonthEnd([wallet('a')], movimientos, [], fecha);
    expect(result.a).toMatchObject({ diasRestantes: 11, gastoVariable: 0.55, previsto: 999.45 });
  });

  it('no modifica carteras ni movimientos al simular el reparto', () => {
    const huchas = [wallet('a', { extra_importe: 50, extra_meses: [11] })];
    const movimientos = [movement('nómina', 1000, { tipo: 'ingreso', categoria: 'nomina', fecha_operacion: new Date(2026, 9, 25) })];
    const original = structuredClone({ huchas, movimientos, now });
    forecastMonthEnd(huchas, movimientos, [], now);
    expect({ huchas, movimientos, now }).toEqual(original);
  });
});
