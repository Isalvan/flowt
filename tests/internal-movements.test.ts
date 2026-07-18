import { describe, expect, it } from 'vitest';
import { crearRetiradaEfectivo, cuentaEnEstadisticas } from '../src/utils/movements';

describe('cuentaEnEstadisticas', () => {
  it('excluye movimientos internos', () => {
    expect(cuentaEnEstadisticas({ es_interno: true })).toBe(false);
  });

  it('incluye movimientos externos o antiguos sin marca', () => {
    expect(cuentaEnEstadisticas({ es_interno: false })).toBe(true);
    expect(cuentaEnEstadisticas({})).toBe(true);
  });

  it('crea una retirada de cajero con dos patas internas vinculadas', () => {
    const [salida, entrada] = crearRetiradaEfectivo({
      gasto_id: 'salida',
      ingreso_id: 'entrada',
      transfer_id: 'retirada-1',
      concepto: 'Cajero',
      importe: 30,
      fecha_operacion: new Date('2026-06-09'),
      hucha_origen_id: 'personal',
      hucha_efectivo_id: 'efectivo',
    });

    expect(salida).toMatchObject({ tipo: 'gasto', es_interno: true, transfer_id: 'retirada-1' });
    expect(entrada).toMatchObject({ tipo: 'ingreso', es_interno: true, transfer_id: 'retirada-1' });
    expect([salida, entrada].filter(cuentaEnEstadisticas)).toHaveLength(0);
  });

  it('mantiene un gasto real pagado en efectivo en las estadísticas', () => {
    expect(cuentaEnEstadisticas({ es_metalico: true })).toBe(true);
  });
});
