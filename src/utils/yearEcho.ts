import type { Movimiento, Suscripcion } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { isSubscriptionMovement, merchantKey } from './serviceNames';
import { parseSubscriptionDate } from './subscriptions';

/**
 * «El eco del año pasado»: lo que pagaste por estas fechas hace un año y que no es una
 * suscripción (seguros, ITV, regalos, matrículas…). Es el gasto que no avisa porque solo
 * llega una vez al año, o el comercio de siempre que en estas fechas se dispara.
 */
export interface EchoItem {
  key: string;
  nombre: string;
  categoria?: string;
  /** `anual`: el comercio apenas aparece el resto del año. `pico`: es habitual, pero en estas fechas se disparó. */
  tipo: 'anual' | 'pico';
  /** Primer cargo de la ventana del año pasado. */
  fechaPasada: Date;
  /** La misma fecha este año. */
  fecha: Date;
  /** Días desde hoy hasta `fecha` (0 = hoy). */
  dias: number;
  /** `anual`: lo que pagaste. `pico`: lo que pagaste por encima de tu gasto normal ahí. */
  importe: number;
  /** Solo en `pico`: cuántas veces lo normal fue el gasto de esas fechas. */
  veces?: number;
  /** Solo en `anual`: si este año ya se ha cobrado (en los últimos 60 días). */
  pagado: { fecha: Date; importe: number } | null;
  antesDeNomina: boolean;
}

export interface YearEcho {
  items: EchoItem[];
  /** Suma de lo que aún no se ha cobrado este año. */
  pendiente: number;
  horizonte: number;
}

export interface YearEchoOptions {
  /** Días hacia delante que se miran. */
  horizonte?: number;
  /** Fecha estimada de la próxima nómina, para marcar lo que llega antes. */
  proximaNomina?: Date | null;
  /** Máximo de avisos, los de mayor importe. */
  max?: number;
}

const DAY = 86_400_000;
const PAID_LOOKBACK_DAYS = 60;
// A merchant seen in more months than this between last year's echo and now is part of the routine.
const MAX_MONTHS_FOR_YEARLY = 1;
const SPIKE_FACTOR = 2;
const MIN_THRESHOLD = 40;
const MAX_THRESHOLD = 150;

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const addYears = (date: Date, years: number) => new Date(date.getFullYear() + years, date.getMonth(), date.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY);
const round2 = (value: number) => Math.round(value * 100) / 100;
const monthKey = (date: Date) => date.getFullYear() * 12 + date.getMonth();
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

interface Entry { movement: Movimiento; date: Date; amount: number }

/** `null` mientras Flowt no tenga movimientos de hace un año con los que comparar. */
export function yearEcho(
  movimientos: readonly Movimiento[], suscripciones: readonly Suscripcion[], now = new Date(), options: YearEchoOptions = {},
): YearEcho | null {
  const horizonte = options.horizonte ?? 45;
  const today = parseSubscriptionDate(now)!;
  const from = addYears(today, -1);
  const to = addDays(from, horizonte);

  const dated = movimientos.flatMap(movement => {
    const date = parseSubscriptionDate(movement.fecha_operacion);
    return date && date <= today ? [{ movement, date }] : [];
  });
  const earliest = dated.reduce<Date | null>((min, { date }) => !min || date < min ? date : min, null);
  // A week of slack: a history that starts a few days late still covers most of the window.
  if (!earliest || earliest > addDays(from, 7)) return null;

  const names = suscripciones.map(s => s.nombre);
  const subscriptionKeys = names.map(merchantKey).filter(key => key.length >= 5);
  // Bank concepts add words after the name ("Gimnasio Forma anual"); those are already in the subscriptions list.
  const isSubscriptionKey = (key: string) => subscriptionKeys.some(sub => key === sub || key.startsWith(`${sub} `));
  const entries: Entry[] = dated.flatMap(({ movement, date }) => {
    if (movement.tipo !== 'gasto' || !cuentaEnEstadisticas(movement) || movement.es_metalico || movement.suscripcion_id
      || isSubscriptionMovement(movement.concepto, names)) return [];
    const amount = importeEnEstadisticas(movement);
    return Number.isFinite(amount) && amount > 0 ? [{ movement, date, amount }] : [];
  });
  // "Out of the ordinary" scales with how this person spends, between 40 € and 150 €.
  const threshold = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, median(entries.map(e => e.amount)) * 3));

  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = merchantKey(entry.movement.concepto);
    if (key.length < 3 || isSubscriptionKey(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  // Days of history outside last year's window, to price a merchant's usual spend per day.
  const historyStart = earliest < from ? earliest : from;
  const usualDays = Math.max(1, daysBetween(historyStart, today) - horizonte);
  const paidSince = addDays(today, -PAID_LOOKBACK_DAYS);
  const routineUntil = addDays(today, -PAID_LOOKBACK_DAYS);

  const items: EchoItem[] = [];
  for (const [key, group] of groups) {
    const inWindow = group.filter(e => e.date >= from && e.date < to);
    if (!inWindow.length) continue;
    const windowTotal = inWindow.reduce((sum, e) => sum + e.amount, 0);
    const biggest = inWindow.reduce((best, e) => e.amount > best.amount ? e : best);
    const fechaPasada = inWindow.reduce((min, e) => e.date < min ? e.date : min, inWindow[0].date);
    const fecha = addYears(fechaPasada, 1);
    const base = {
      key, nombre: biggest.movement.concepto.trim(), categoria: biggest.movement.categoria,
      fechaPasada, fecha, dias: daysBetween(today, fecha),
      antesDeNomina: Boolean(options.proximaNomina && fecha < parseSubscriptionDate(options.proximaNomina)!),
    };

    const monthsSince = new Set(group.filter(e => e.date >= to && e.date < routineUntil).map(e => monthKey(e.date)));
    if (monthsSince.size <= MAX_MONTHS_FOR_YEARLY) {
      if (windowTotal < threshold) continue;
      const recent = group.filter(e => e.date >= paidSince);
      items.push({
        ...base, tipo: 'anual', importe: round2(windowTotal),
        pagado: recent.length ? {
          fecha: recent.reduce((max, e) => e.date > max ? e.date : max, recent[0].date),
          importe: round2(recent.reduce((sum, e) => sum + e.amount, 0)),
        } : null,
      });
      continue;
    }

    const outside = group.filter(e => e.date < from || e.date >= to).reduce((sum, e) => sum + e.amount, 0);
    const usual = outside / usualDays * horizonte;
    const excess = windowTotal - usual;
    if (windowTotal < usual * SPIKE_FACTOR || excess < threshold) continue;
    items.push({ ...base, tipo: 'pico', importe: round2(excess), veces: usual > 0 ? windowTotal / usual : undefined, pagado: null });
  }

  const picked = items.sort((a, b) => b.importe - a.importe).slice(0, options.max ?? 6)
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || b.importe - a.importe);
  return {
    items: picked,
    pendiente: round2(picked.filter(item => !item.pagado).reduce((sum, item) => sum + item.importe, 0)),
    horizonte,
  };
}
