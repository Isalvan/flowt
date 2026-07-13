import { describe, expect, it } from 'vitest';
import { cuentaEnEstadisticas } from '../src/utils/movements';

describe('cuentaEnEstadisticas', () => {
  it('excluye movimientos internos', () => {
    expect(cuentaEnEstadisticas({ es_interno: true })).toBe(false);
  });

  it('incluye movimientos externos o antiguos sin marca', () => {
    expect(cuentaEnEstadisticas({ es_interno: false })).toBe(true);
    expect(cuentaEnEstadisticas({})).toBe(true);
  });
});