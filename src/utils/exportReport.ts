import type { Movimiento } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';

/** La ventana reciente tiene prioridad si ambos listeners incluyen el mismo id. */
export const unirHistorialExportacion = (recientes: Movimiento[], antiguos: Movimiento[]): Movimiento[] => {
  const ids = new Set<string>();
  return [...recientes, ...antiguos].filter(m => {
    if (ids.has(m.id)) return false;
    ids.add(m.id);
    return true;
  });
};

export const calcularInformeExportacion = (movimientos: Movimiento[]) => {
  const externos: Movimiento[] = [];
  const devoluciones: Movimiento[] = [];
  const internos: Movimiento[] = [];
  let ingresos = 0;
  let gastos = 0;
  let totalDevoluciones = 0;
  let balanceInternos = 0;

  for (const movimiento of movimientos) {
    if (movimiento.es_interno || movimiento.transfer_id) {
      internos.push(movimiento);
      balanceInternos += movimiento.tipo === 'ingreso' ? movimiento.importe : -movimiento.importe;
    } else if (cuentaEnEstadisticas(movimiento)) {
      externos.push(movimiento);
      const neto = importeEnEstadisticas(movimiento);
      if (movimiento.tipo === 'ingreso') {
        ingresos += neto;
        totalDevoluciones += movimiento.importe - neto;
      } else {
        gastos += neto;
      }
    } else if (movimiento.tipo === 'ingreso') {
      devoluciones.push(movimiento);
      totalDevoluciones += movimiento.importe;
    }
  }

  const centimos = (valor: number) => Math.round(valor * 100) / 100;
  return {
    externos, devoluciones, internos,
    ingresos: centimos(ingresos), gastos: centimos(gastos), balance: centimos(ingresos - gastos),
    totalDevoluciones: centimos(totalDevoluciones), balanceInternos: centimos(balanceInternos),
  };
};
