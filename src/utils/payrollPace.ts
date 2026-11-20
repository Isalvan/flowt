import type { Hucha, Movimiento } from '../types';
import { roundMoney } from './incomeSplit';
import { importeEnEstadisticas } from './movements';
import { isPayrollMovement } from './payroll';
import { freeWalletOf, isFreeSpending, payrollLibre } from './payrollFree';
import { parseMovimientoDate } from './periodStats';

/** A cycle shorter than this, such as one cut by an extra payment, joins the cycle before it. */
export const MIN_CYCLE_DAYS = 20;
/** A longer cycle means a payroll is missing, so it is left out of the comparison. */
export const MAX_CYCLE_DAYS = 45;
export const MAX_GHOST_DAY = 35;
const MIN_CYCLES = 2;
const DEFAULT_MAX_CYCLES = 6;

/** Calendar day number, unaffected by daylight saving changes. */
const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
const localDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const round1 = (value: number) => Math.round(value * 10) / 10;

export interface PayrollCycle {
  start: Date;
  /** Exclusive: the day of the next payroll. */
  end: Date;
  libre: number;
  /** True when some payroll in the cycle had no recorded split and used the current rules. */
  reglasActuales: boolean;
  /** Cumulative free spending at the end of each day, from day 0 (the payroll day). */
  acumulado: number[];
}

export interface PacePoint {
  dia: number;
  actual?: number;
  /** Current spending in euros, for the tooltip. */
  actualImporte?: number;
  fantasma?: number;
  banda?: [number, number];
}

export interface PayrollPace {
  unidad: 'porcentaje' | 'euros';
  puntos: PacePoint[];
  /** Days since the latest payroll; 0 on payroll day. */
  hoy: number;
  libre: number;
  gastado: number;
  /** Today's value in the chosen unit. */
  actual: number;
  /** The ghost's value today, or null when the history doesn't reach today. */
  fantasmaHoy: number | null;
  /** Positive: spending slower than usual. Null when it can't be told. */
  diasDeVentaja: number | null;
  /** True when the ghost never crossed your spending in its history: the gap is at least diasDeVentaja. */
  alMenos: boolean;
  ciclos: number;
  reglasActuales: boolean;
}

interface DatedMovement { movement: Movimiento; fecha: Date }

/** Cumulative free spending per day from `start`, over `days` days, up to `until`. */
function cumulative(spending: readonly DatedMovement[], start: Date, days: number, until?: Date): number[] {
  const perDay = new Array<number>(days).fill(0);
  const first = dayNumber(start);
  for (const { movement, fecha } of spending) {
    if (fecha < start || (until && fecha > until)) continue;
    const day = dayNumber(fecha) - first;
    if (day >= 0 && day < days) perDay[day] += importeEnEstadisticas(movement);
  }
  let total = 0;
  return perDay.map(amount => roundMoney(total += amount));
}

/** Past payroll cycles, oldest first, ending at the latest payroll. */
export function payrollCycles(movimientos: readonly Movimiento[], huchas: Hucha[], now = new Date()): PayrollCycle[] {
  const payrolls = movimientos.flatMap(movement => {
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    return isPayrollMovement(movement) && fecha && fecha <= now ? [{ movement, fecha }] : [];
  }).sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  if (payrolls.length < 2) return [];
  const starts = [...new Set(payrolls.map(({ fecha }) => localDay(fecha).getTime()))].map(time => new Date(time));
  const freeWallet = freeWalletOf(huchas);
  const spending = movimientos.flatMap(movement => {
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    return fecha && isFreeSpending(movement, huchas, freeWallet) ? [{ movement, fecha }] : [];
  });

  // Join each short cycle to the one before it, so cycles keep starting on the regular payroll.
  const bounds: { start: Date; end: Date }[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const start = starts[i];
    const end = starts[i + 1];
    const previous = bounds.at(-1);
    if (previous && dayNumber(end) - dayNumber(start) < MIN_CYCLE_DAYS) previous.end = end;
    else bounds.push({ start, end });
  }
  // A short first cycle has nothing before it to join.
  if (bounds[0] && dayNumber(bounds[0].end) - dayNumber(bounds[0].start) < MIN_CYCLE_DAYS) bounds.shift();

  return bounds.map(({ start, end }) => {
    const inCycle = payrolls.filter(({ fecha }) => fecha >= start && fecha < end);
    const days = dayNumber(end) - dayNumber(start);
    return {
      start, end,
      libre: roundMoney(inCycle.reduce((sum, { movement }) => sum + payrollLibre(movement, huchas), 0)),
      reglasActuales: inCycle.some(({ movement }) => movement.reparto_aplicado == null),
      acumulado: cumulative(spending, start, days),
    };
  });
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Compares the free spending since the latest payroll with earlier payroll
 * cycles on the same day: the ghost is their median, with a typical range.
 * The current cycle starts at the latest payroll, as in payrollSummary.
 */
export function payrollPace(
  movimientos: readonly Movimiento[],
  huchas: Hucha[],
  now = new Date(),
  { maxCycles = DEFAULT_MAX_CYCLES } = {},
): PayrollPace | null {
  const latest = movimientos.flatMap(movement => {
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    return isPayrollMovement(movement) && fecha && fecha <= now ? [{ movement, fecha }] : [];
  }).sort((a, b) => b.fecha.getTime() - a.fecha.getTime())[0];
  if (!latest) return null;

  const freeWallet = freeWalletOf(huchas);
  const libre = payrollLibre(latest.movement, huchas);
  const hoy = Math.max(0, dayNumber(now) - dayNumber(latest.fecha));
  const spending = movimientos.flatMap(movement => {
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    return fecha && isFreeSpending(movement, huchas, freeWallet) ? [{ movement, fecha }] : [];
  });
  const current = cumulative(spending, latest.fecha, hoy + 1, now);
  const gastado = current[hoy];
  const unidad = libre > 0 ? 'porcentaje' : 'euros';
  const scale = (amount: number, base: number) => unidad === 'porcentaje' ? round1(amount / base * 100) : amount;

  // Cycles that start before the first known movement may be missing spending.
  const firstDay = Math.min(...movimientos.flatMap(movement => {
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    return fecha ? [dayNumber(fecha)] : [];
  }));
  const cycles = payrollCycles(movimientos, huchas, now).filter(cycle => {
    const days = dayNumber(cycle.end) - dayNumber(cycle.start);
    return days <= MAX_CYCLE_DAYS && dayNumber(cycle.start) >= firstDay && (unidad === 'euros' || cycle.libre > 0);
  }).slice(-maxCycles);

  const ghost: { mediana: number; bajo: number; alto: number }[] = [];
  if (cycles.length >= MIN_CYCLES) {
    for (let day = 0; day <= MAX_GHOST_DAY; day++) {
      const values = cycles.filter(cycle => cycle.acumulado.length > day)
        .map(cycle => scale(cycle.acumulado[day], cycle.libre)).sort((a, b) => a - b);
      if (values.length < MIN_CYCLES) break;
      const wide = values.length < 4;
      ghost.push({
        mediana: round1(quantile(values, 0.5)),
        bajo: round1(wide ? values[0] : quantile(values, 0.25)),
        alto: round1(wide ? values.at(-1)! : quantile(values, 0.75)),
      });
    }
  }

  const actual = scale(gastado, libre);
  const fantasmaHoy = ghost[hoy]?.mediana ?? null;
  let diasDeVentaja: number | null = null;
  let alMenos = false;
  if (hoy > 0 && fantasmaHoy !== null) {
    // Euros compare to the cent; a percentage to its rounding.
    const tolerance = unidad === 'porcentaje' ? 0.5 : 0.01;
    if (Math.abs(actual - fantasmaHoy) <= tolerance) {
      diasDeVentaja = 0;
    } else if (actual < fantasmaHoy) {
      // You have spent what the ghost had spent some days ago.
      const day = ghost.slice(0, hoy + 1).findLastIndex(point => point.mediana <= actual + tolerance);
      alMenos = day < 0;
      diasDeVentaja = hoy - Math.max(0, day);
    } else {
      // The ghost only spends this much some days from now.
      const day = ghost.findIndex((point, index) => index > hoy && point.mediana >= actual - tolerance);
      alMenos = day < 0;
      diasDeVentaja = day < 0 ? -(ghost.length - hoy) : -(day - hoy);
    }
  }

  const puntos: PacePoint[] = [];
  for (let dia = 0; dia < Math.max(ghost.length, hoy + 1); dia++) {
    puntos.push({
      dia,
      ...(dia <= hoy && { actual: scale(current[dia], libre), actualImporte: current[dia] }),
      ...(ghost[dia] && { fantasma: ghost[dia].mediana, banda: [ghost[dia].bajo, ghost[dia].alto] as [number, number] }),
    });
  }

  return {
    unidad, puntos, hoy, libre, gastado, actual, fantasmaHoy, diasDeVentaja, alMenos,
    ciclos: cycles.length,
    reglasActuales: cycles.some(cycle => cycle.reglasActuales),
  };
}

export const dayCount = (count: number) => `${count} ${count === 1 ? 'día' : 'días'}`;

/** One sentence on the pace, in the user's terms. */
export function paceHeadline(pace: PayrollPace): string {
  if (pace.hoy === 0) return 'Acabas de cobrar: desde mañana verás tu ritmo';
  if (pace.diasDeVentaja === null) return 'Este ciclo ya dura más que los anteriores';
  const lead = Math.abs(pace.diasDeVentaja);
  if (lead === 0) return 'Vas a tu ritmo habitual';
  const amount = pace.alMenos ? `más de ${dayCount(lead)}` : dayCount(lead);
  return pace.diasDeVentaja > 0 ? `Vas ${amount} por delante de tu ritmo habitual` : `Vas ${amount} por detrás de tu ritmo habitual`;
}
