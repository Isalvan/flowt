import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { calcularInformeExportacion, unirHistorialExportacion } from './exportReport';

const movimiento = (id: string, tipo: Movimiento['tipo'], importe: number, extra: Partial<Movimiento> = {}): Movimiento =>
  ({ id, tipo, importe, concepto: id, fecha_operacion: '2026-10-01', ...extra });

describe('informe de exportación', () => {
  it('descuenta devoluciones y separa las dos patas de una transferencia', () => {
    const informe = calcularInformeExportacion([
      movimiento('gasto', 'gasto', 209.99, { importe_neto: 105, compensado_por: ['devolucion'] }),
      movimiento('devolucion', 'ingreso', 104.99, { compensa_movimiento_id: 'gasto' }),
      movimiento('nomina', 'ingreso', 2000),
      movimiento('salida', 'gasto', 300, { transfer_id: 'transferencia' }),
      movimiento('entrada', 'ingreso', 300, { transfer_id: 'transferencia' }),
    ]);
    expect(informe.ingresos).toBe(2000);
    expect(informe.gastos).toBe(105);
    expect(informe.totalDevoluciones).toBe(104.99);
    expect(informe.balance).toBe(1895);
    expect(informe.balanceInternos).toBe(0);
    expect(informe.devoluciones.map(m => m.id)).toEqual(['devolucion']);
    expect(informe.internos.map(m => m.id)).toEqual(['salida', 'entrada']);
  });

  it('cuenta la parte libre como ingreso y la asignada como devolución', () => {
    const informe = calcularInformeExportacion([
      movimiento('parcial', 'ingreso', 150, { compensaciones_destinos: [{ gasto_id: 'gasto', importe: 50 }] }),
      movimiento('gasto', 'gasto', 100, { compensado_por_detalles: [{ ingreso_id: 'parcial', importe: 50 }] }),
    ]);
    expect(informe.externos.map(m => m.id)).toEqual(['parcial', 'gasto']);
    expect(informe.devoluciones).toEqual([]);
    expect(informe.ingresos).toBe(100);
    expect(informe.gastos).toBe(50);
    expect(informe.totalDevoluciones).toBe(50);
    expect(informe.ingresos + informe.totalDevoluciones).toBe(150);
  });

  it('clasifica una compensación completa M:N y da prioridad al carácter interno', () => {
    const informe = calcularInformeExportacion([
      movimiento('completo', 'ingreso', 80, { compensaciones_destinos: [{ gasto_id: 'gasto', importe: 80 }] }),
      movimiento('interno', 'ingreso', 20, { es_interno: true, compensa_movimiento_id: 'gasto' }),
    ]);
    expect(informe.devoluciones.map(m => m.id)).toEqual(['completo']);
    expect(informe.internos.map(m => m.id)).toEqual(['interno']);
    expect(informe.totalDevoluciones).toBe(80);
  });

  it('une todo el historial sin duplicados y concilia el periodo sin filtros', () => {
    const reciente = movimiento('reciente', 'ingreso', 1000);
    const antiguo = movimiento('antiguo', 'gasto', 209.99, { importe_neto: 105 });
    const historial = unirHistorialExportacion([reciente], [antiguo, { ...reciente, importe: 999 }]);
    expect(historial).toHaveLength(2);
    expect(historial.map(m => m.id)).toEqual(['reciente', 'antiguo']);
    const historico = calcularInformeExportacion(historial);
    const periodo = calcularInformeExportacion(historial.filter(() => true));
    expect(historico.ingresos).toBe(1000);
    expect(historico.gastos).toBe(105);
    expect(historico.ingresos - historico.gastos).toBe(periodo.balance);
  });
});
