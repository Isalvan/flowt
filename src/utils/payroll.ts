import type { Movimiento } from '../types';
import { isPayrollConcept } from './movementSuggestions';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { parseMovimientoDate } from './periodStats';

export interface Payroll {
  importe: number;
  fecha: Date;
  diaHabitual: number;
}

export function isPayrollMovement(movimiento: Movimiento): boolean {
  return movimiento.tipo === 'ingreso' && cuentaEnEstadisticas(movimiento) &&
    (movimiento.categoria === 'nomina' || (!movimiento.categoria && isPayrollConcept(movimiento.concepto)));
}

export function detectPayroll(movimientos: Movimiento[], now = new Date()): Payroll | null {
  const start = now.getTime() - 190 * 24 * 60 * 60 * 1000;
  const candidates = movimientos.flatMap(movimiento => {
    if (!isPayrollMovement(movimiento)) return [];
    const fecha = parseMovimientoDate(movimiento.fecha_operacion);
    if (!fecha || fecha.getTime() < start || fecha > now) return [];
    return [{ importe: importeEnEstadisticas(movimiento), fecha }];
  }).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  if (!candidates.length) return null;
  const days = candidates.slice(0, 6).map(candidate => candidate.fecha.getDate()).sort((a, b) => a - b);
  const middle = Math.floor(days.length / 2);
  const diaHabitual = days.length % 2 ? days[middle] : (days[middle - 1] + days[middle]) / 2;
  return { ...candidates[0], diaHabitual };
}

export function hourlyRate(payroll: Payroll | null | undefined, horasSemanales: number | null | undefined): number | null {
  if (!payroll || horasSemanales == null || !Number.isFinite(horasSemanales) || horasSemanales <= 0) return null;
  return payroll.importe / (horasSemanales * 52 / 12);
}

/** Tiempo de trabajo en horas, escrito como «45 min», «4 h 20 min» o «120 h». */
export function formatWorkTime(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} min`;
  if (minutes >= 100 * 60) return `${Math.round(minutes / 60)} h`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}
