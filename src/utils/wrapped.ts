import type { Movimiento } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { categoryLabel as defaultCategoryLabel } from './movementSuggestions';
import { groupExpensesByCategory, parseMovimientoDate, type CategoryExpense } from './periodStats';
import { payrollDates, periodName, periodOf, previousPeriod, type InicioPeriodo, type Period } from './periods';
import { merchantKey } from './serviceNames';
import { summarizeSmallPurchases, type SmallPurchasesSummary } from './smallPurchases';
import {
  buildInventory, choosePersonality, selectHighlights,
  type HistoryPoint, type InsightContext, type InsightEntry, type WrappedHighlight, type WrappedMerchant,
  type WrappedPersonality, type WrappedScope, type WrappedStreak,
} from './wrappedInsights';

export type { WrappedScope, WrappedTone, WrappedIcon, WrappedHighlight, WrappedVisual, WrappedFormat, WrappedMerchant, WrappedStreak, WrappedPersonality } from './wrappedInsights';
export { selectHighlights, buildInventory } from './wrappedInsights';
export interface WrappedPeriod extends Period {
  scope: WrappedScope;
  key: string;
  label: string;
  parcial?: boolean;
}
export interface WrappedOptions {
  categoryLabel?: (id: string) => string;
  previous?: Period;
  now?: Date;
  /** Internal: how many previous Wrappeds to look back at when rotating cards (default 3). */
  rotacion?: number;
}
export interface WrappedTotals {
  ingresos: number;
  gastos: number;
  ahorro: number;
  tasaAhorro: number | null;
  numGastos: number;
  numComercios: number;
}
export interface WrappedComparison { gastosAnterior: number; deltaPct: number }
export interface WrappedCategory extends CategoryExpense { label: string }
export interface WrappedPurchase { concepto: string; importe: number; fecha: Date }
export interface WrappedDay { fecha: Date; total: number }
export interface WrappedMonth { mes: number; total: number }
export interface WrappedWeekday { dia: number; porcentaje: number }
export interface WrappedData {
  period: WrappedPeriod;
  totales: WrappedTotals;
  comparativa: WrappedComparison | null;
  comercioFavorito: WrappedMerchant | null;
  comercioTop: WrappedMerchant | null;
  topCategorias: WrappedCategory[];
  compraMayor: WrappedPurchase;
  diaMasCaro: WrappedDay | null;
  serieDiaria: WrappedDay[];
  mesMasCaro: WrappedMonth | null;
  mesMasBarato: WrappedMonth | null;
  serieMensual: number[];
  semanaMasCara: WrappedDay;
  diaSemanaFavorito: WrappedWeekday;
  rachaSinGastos: WrappedStreak;
  pequenas: SmallPurchasesSummary;
  suscripciones: number;
  personalidad: WrappedPersonality;
  curiosidades: string[];
  /** Every card that applies to this period, best first. */
  inventario: WrappedHighlight[];
  /** Ids of the cards to show, in display order. */
  destacados: string[];
  /** Earlier periods with data, oldest first. */
  historia: HistoryPoint[];
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const nextDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
const monthName = (date: Date) => date.toLocaleDateString('es-ES', { month: 'long' });
const natural = (period: Period) => period.start.getDate() === 1 && period.end.getDate() === 1;
const FULL_MONTHS: Record<string, string> = {
  ene: 'enero', feb: 'febrero', mar: 'marzo', abr: 'abril', may: 'mayo', jun: 'junio',
  jul: 'julio', ago: 'agosto', sep: 'septiembre', oct: 'octubre', nov: 'noviembre', dic: 'diciembre',
};
// A payroll month (10 Oct – 9 Nov) is named after the calendar month it mostly covers.
const monthlyLabel = (period: Period) => natural(period) ? monthName(period.start) : FULL_MONTHS[periodName(period)] ?? periodName(period);
const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

type Entry = InsightEntry;
// Parsing dates and amounts is the expensive part, and a Wrapped looks at the same
// movements many times (previous periods, history, rotation). Parse each list once,
// sorted by date, and slice periods out of it with a binary search.
const prepared = new WeakMap<readonly Movimiento[], Entry[]>();
function allEntries(movimientos: readonly Movimiento[]): Entry[] {
  let rows = prepared.get(movimientos);
  if (!rows) {
    rows = movimientos.flatMap((movement, index) => {
      if (!cuentaEnEstadisticas(movement)) return [];
      const fecha = parseMovimientoDate(movement.fecha_operacion);
      if (!fecha) return [];
      const cents = Math.round(importeEnEstadisticas(movement) * 100);
      return Number.isFinite(cents) && cents > 0 ? [{ movement, fecha, cents, index }] : [];
    }).sort((a, b) => +a.fecha - +b.fecha || a.index - b.index)
      .map(({ movement, fecha, cents }) => ({ movement, fecha, cents }));
    prepared.set(movimientos, rows);
  }
  return rows;
}
function firstAtOrAfter(rows: Entry[], time: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (+rows[mid].fecha < time) lo = mid + 1; else hi = mid;
  }
  return lo;
}
function entries(movimientos: readonly Movimiento[], period: Period): Entry[] {
  const rows = allEntries(movimientos);
  return rows.slice(firstAtOrAfter(rows, +period.start), firstAtOrAfter(rows, +period.end));
}
const payrollCache = new WeakMap<readonly Movimiento[], Date[]>();
function cachedPayrollDates(movimientos: readonly Movimiento[]): Date[] {
  let dates = payrollCache.get(movimientos);
  if (!dates) {
    dates = payrollDates(movimientos);
    payrollCache.set(movimientos, dates);
  }
  return dates;
}
const hasStory = (movimientos: readonly Movimiento[], period: Period) =>
  entries(movimientos, period).reduce((n, row) => n + (row.movement.tipo === 'gasto' ? 1 : 0), 0) >= MIN_EXPENSES;
const MIN_EXPENSES = 5;
const isFixedExpense = (m: Movimiento) => Boolean(m.suscripcion_id) || m.categoria === 'vivienda';
const sum = (rows: Entry[]) => rows.reduce((total, row) => total + row.cents, 0) / 100;

const HIGHLIGHTS_MONTH = 7;
const HIGHLIGHTS_YEAR = 10;

/** Spending of up to six earlier months (or two earlier years), oldest first, skipping periods without data. */
function history(movimientos: readonly Movimiento[], period: WrappedPeriod, previous: Period, inicio: InicioPeriodo, nominas: readonly Date[]): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  let current = previous;
  for (let i = 0; i < (period.scope === 'anio' ? 2 : 6); i++) {
    const rows = entries(movimientos, current);
    const gastos = sum(rows.filter(row => row.movement.tipo === 'gasto'));
    if (gastos > 0) {
      points.unshift({
        label: period.scope === 'anio' ? String(current.start.getFullYear()) : monthlyLabel(current),
        corto: period.scope === 'anio' ? String(current.start.getFullYear()) : periodName(current),
        gastos, ingresos: sum(rows.filter(row => row.movement.tipo === 'ingreso')),
      });
    }
    current = period.scope === 'anio'
      ? { start: new Date(current.start.getFullYear() - 1, 0, 1), end: new Date(current.end.getFullYear() - 1, current.end.getMonth(), current.end.getDate()) }
      : previousPeriod(current, inicio, nominas);
  }
  return points;
}

/** Builds a summary for [start, end); all calendar buckets use local days. */
export function buildWrapped(
  movimientos: readonly Movimiento[], period: WrappedPeriod, opts: WrappedOptions = {},
): WrappedData | null {
  const now = opts.now ?? new Date();
  const rows = entries(movimientos, period);
  const expenses = rows.filter(row => row.movement.tipo === 'gasto');
  if (expenses.length < MIN_EXPENSES) return null;
  const gastos = sum(expenses);
  const ingresos = sum(rows.filter(row => row.movement.tipo === 'ingreso'));
  const ahorro = round(ingresos - gastos);
  const tasaAhorro = ingresos ? round(ahorro / ingresos * 100) : null;
  const merchants = new Map<string, WrappedMerchant & { latest: number }>();
  const daily = new Map<number, number>();
  const weekly = new Map<number, number>();
  const monthly = Array<number>(12).fill(0);
  const weekdays = Array<number>(7).fill(0);
  // Rent and subscriptions land on the same day every month; leaving them out of
  // peaks, weekdays and the biggest purchase keeps those cards about real habits.
  const variable = expenses.filter(row => !isFixedExpense(row.movement));
  const habitRows = variable.length >= 3 ? variable : expenses;
  const spendDays = new Set(expenses.map(row => +day(row.fecha)));
  for (const { fecha, cents } of habitRows) {
    const date = day(fecha);
    daily.set(+date, (daily.get(+date) ?? 0) + cents);
    const weekday = (fecha.getDay() + 6) % 7;
    weekdays[weekday] += cents;
    date.setDate(date.getDate() - weekday);
    weekly.set(+date, (weekly.get(+date) ?? 0) + cents);
  }
  for (const { movement, fecha, cents } of expenses) {
    monthly[fecha.getMonth()] += cents;
    // Rent and subscriptions are bills, not places you choose to go.
    if (isFixedExpense(movement) || movement.categoria === 'nomina') continue;
    const key = merchantKey(movement.concepto);
    if (key.length < 3 || !/[a-z]{3}/.test(key)) continue;
    const merchant = merchants.get(key) ?? { key, nombre: movement.concepto, visitas: 0, total: 0, latest: -Infinity };
    merchant.visitas++;
    merchant.total += cents;
    if (+fecha > merchant.latest) { merchant.nombre = movement.concepto; merchant.latest = +fecha; }
    merchants.set(key, merchant);
  }
  const merchantList: WrappedMerchant[] = [...merchants.values()].map(({ key, nombre, visitas, total }) => ({ key, nombre, visitas, total: total / 100 }));
  const comercioFavorito = [...merchantList].sort((a, b) => b.visitas - a.visitas || b.total - a.total || a.key.localeCompare(b.key))[0] ?? null;
  const comercioTop = [...merchantList].sort((a, b) => b.total - a.total || b.visitas - a.visitas || a.key.localeCompare(b.key))[0] ?? null;
  const categories = groupExpensesByCategory(expenses.map(({ movement }) => movement), m => m.categoria || m.categoria_sugerida);
  const topCategorias = categories.slice(0, 3).map(category => ({ ...category, label: (opts.categoryLabel ?? defaultCategoryLabel)(category.categoria) }));
  const largest = [...habitRows].sort((a, b) => b.cents - a.cents || +a.fecha - +b.fecha)[0];
  const serieDiaria: WrappedDay[] = [];
  let rachaSinGastos: WrappedStreak = { dias: 0, desde: null, hasta: null };
  let streakStart: Date | null = null;
  let streakLength = 0;
  let elapsedDays = 0;
  for (let date = day(period.start); date < period.end; date = nextDay(date)) {
    const total = (daily.get(+date) ?? 0) / 100;
    if (period.scope === 'mes') serieDiaria.push({ fecha: date, total });
    if (date > now) continue;
    elapsedDays++;
    if (spendDays.has(+date)) { streakStart = null; streakLength = 0; continue; }
    streakStart ??= date;
    streakLength++;
    if (streakLength > rachaSinGastos.dias) rachaSinGastos = { dias: streakLength, desde: streakStart, hasta: date };
  }
  const months = monthly.map((total, mes) => ({ mes, total: total / 100 }));
  // Empty elapsed months participate; future months cannot be the cheapest month.
  const elapsedMonths = months.filter(({ mes }) => new Date(period.start.getFullYear(), mes, 1) < period.end && new Date(period.start.getFullYear(), mes, 1) <= now);
  const week = [...weekly].sort(([a, x], [b, y]) => y - x || a - b)[0];
  const favoriteDay = weekdays.indexOf(Math.max(...weekdays));
  const weekdayTotal = weekdays.reduce((a, b) => a + b, 0);
  const diaSemanaFavorito = { dia: favoriteDay, porcentaje: weekdayTotal ? round(weekdays[favoriteDay] / weekdayTotal * 100) : 0 };
  const nominas = cachedPayrollDates(movimientos);
  const payrollPeriod = nominas.some(date => +date === +period.start) && nominas.some(date => +date === +period.end);
  const previous = opts.previous ?? (period.scope === 'anio'
    // A partial year ("hasta hoy") is compared with the same span of the previous year.
    ? { start: new Date(period.start.getFullYear() - 1, 0, 1), end: new Date(period.end.getFullYear() - 1, period.end.getMonth(), period.end.getDate()) }
    : previousPeriod(period, payrollPeriod ? 'nomina' : period.start.getDate(), nominas));
  const gastosAnterior = sum(entries(movimientos, previous).filter(row => row.movement.tipo === 'gasto'));
  const comparativa = gastosAnterior > 0 ? { gastosAnterior, deltaPct: round((gastos - gastosAnterior) / gastosAnterior * 100) } : null;
  const pequenas = summarizeSmallPurchases(expenses.map(({ movement }) => movement), 5);
  const curiosidades: string[] = [];
  if (comparativa && Math.abs(comparativa.deltaPct) >= 5) {
    const label = period.scope === 'anio' ? String(previous.start.getFullYear()) : monthlyLabel(previous);
    curiosidades.push(`Gastaste un ${Math.round(Math.abs(comparativa.deltaPct))} % ${comparativa.deltaPct < 0 ? 'menos' : 'más'} que en ${label}.`);
  }
  if (comercioFavorito) {
    const interval = Math.max(1, Math.round(elapsedDays / comercioFavorito.visitas));
    const frequency = interval === 1 ? 'una al día' : interval === 2 ? 'una cada dos días' : `una cada ${interval} días`;
    curiosidades.push(`Pasaste por ${comercioFavorito.nombre} ${comercioFavorito.visitas} ${comercioFavorito.visitas === 1 ? 'vez' : 'veces'}: ${frequency}.`);
  }
  if (rachaSinGastos.dias >= 3) curiosidades.push(`Estuviste ${rachaSinGastos.dias} días seguidos sin gastar un euro.`);
  if (pequenas.count >= 5) curiosidades.push(`${pequenas.count} compras de menos de 5 € sumaron ${money.format(pequenas.total)}.`);
  if (diaSemanaFavorito.porcentaje >= 25) {
    const names = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
    curiosidades.push(`Los ${names[favoriteDay]} son tu día: el ${Math.round(diaSemanaFavorito.porcentaje)} % de tu gasto.`);
  }
  const previousExpenses = entries(movimientos, previous).filter(row => row.movement.tipo === 'gasto');
  const previousMerchants = new Map<string, { nombre: string; visitas: number }>();
  for (const { movement } of previousExpenses) {
    if (movement.suscripcion_id || movement.categoria === 'nomina') continue;
    const key = merchantKey(movement.concepto);
    if (key.length < 3 || !/[a-z]{3}/.test(key)) continue;
    const entry = previousMerchants.get(key) ?? { nombre: movement.concepto, visitas: 0 };
    entry.visitas++;
    previousMerchants.set(key, entry);
  }
  const previousCategories = new Map(groupExpensesByCategory(previousExpenses.map(row => row.movement), m => m.categoria || m.categoria_sugerida)
    .map(c => [c.categoria, c.total]));
  const historia = history(movimientos, period, previous, payrollPeriod ? 'nomina' : period.start.getDate(), nominas);
  const ctx: InsightContext = {
    scope: period.scope, seedKey: period.key, start: period.start, end: period.end,
    expenses, habitRows, previousExpenses, incomes: rows.filter(row => row.movement.tipo === 'ingreso'),
    gastos, ingresos, ahorro, tasaAhorro, gastosAnterior, categories, previousCategories,
    merchantList, previousMerchants, comercioFavorito, comercioTop, largest, rachaSinGastos, elapsedDays,
    daily, spendDays, monthly, weekdays, pequenas, suscripciones: sum(expenses.filter(row => Boolean(row.movement.suscripcion_id))),
    historia, label: period.scope === 'anio' ? String(period.start.getFullYear()) : period.label,
    previousLabel: period.scope === 'anio' ? String(previous.start.getFullYear()) : monthlyLabel(previous),
    categoryLabel: opts.categoryLabel ?? defaultCategoryLabel, merchantKey,
  };
  const inventario = buildInventory(ctx);
  // Rotate: a card that led last period's Wrapped weighs less now, so each month tells something new.
  // The previous Wrapped is itself rotated against the one before, a few levels deep, so the
  // penalty hits what was really shown and months do not just alternate between two picks.
  const depth = opts.rotacion ?? 3;
  const previousWrapped = depth <= 0 || period.parcial
    ? null
    : buildWrapped(movimientos, { ...period, ...previous, key: `${period.key}:prev`, label: period.scope === 'anio' ? String(previous.start.getFullYear()) : monthlyLabel(previous) }, { ...opts, previous: undefined, now, rotacion: depth - 1 });
  const destacados = selectHighlights(inventario, period.scope === 'anio' ? HIGHLIGHTS_YEAR : HIGHLIGHTS_MONTH, previousWrapped?.destacados ?? []);
  const { titulo, descripcion } = choosePersonality(ctx, previousWrapped?.personalidad.titulo);
  return {
    period, totales: { ingresos, gastos, ahorro, tasaAhorro, numGastos: expenses.length, numComercios: merchants.size },
    comparativa, comercioFavorito, comercioTop, topCategorias,
    compraMayor: { concepto: largest.movement.concepto, importe: largest.cents / 100, fecha: new Date(largest.fecha) },
    diaMasCaro: period.scope === 'mes' ? [...serieDiaria].sort((a, b) => b.total - a.total || +a.fecha - +b.fecha)[0] : null,
    serieDiaria,
    mesMasCaro: period.scope === 'anio' ? [...elapsedMonths].sort((a, b) => b.total - a.total || a.mes - b.mes)[0] ?? null : null,
    mesMasBarato: period.scope === 'anio' ? [...elapsedMonths].sort((a, b) => a.total - b.total || a.mes - b.mes)[0] ?? null : null,
    serieMensual: period.scope === 'anio' ? months.map(m => m.total) : [],
    semanaMasCara: { fecha: new Date(week[0]), total: week[1] / 100 }, diaSemanaFavorito, rachaSinGastos,
    pequenas, suscripciones: sum(expenses.filter(row => Boolean(row.movement.suscripcion_id))),
    personalidad: { titulo, descripcion }, curiosidades: curiosidades.slice(0, 4),
    inventario, destacados, historia,
  };
}

/**
 * The user's month for the Wrapped: their chosen period start, or, when they kept the
 * calendar month (the default) but get paid regularly, the month from payroll to payroll.
 */
export function wrappedInicio(movimientos: readonly Movimiento[], inicioPeriodo: InicioPeriodo): InicioPeriodo {
  return inicioPeriodo === 1 && cachedPayrollDates(movimientos).length >= 2 ? 'nomina' : inicioPeriodo;
}

/** Completed monthly periods (at most eleven), followed by the seasonal annual recap. */
export function availableWrappeds(
  movimientos: readonly Movimiento[], now = new Date(), inicioPeriodo: InicioPeriodo = 1,
): WrappedPeriod[] {
  const inicio = wrappedInicio(movimientos, inicioPeriodo);
  const nominas = inicio === 'nomina' ? cachedPayrollDates(movimientos) : [];
  let current = periodOf(now, inicio, nominas);
  const result: WrappedPeriod[] = [];
  for (let i = 0; i < 11; i++) {
    const previous = previousPeriod(current, inicio, nominas);
    // Before the first detected payroll the chain falls back to calendar months, which would overlap.
    if (previous.end > current.start) break;
    current = previous;
    const period: WrappedPeriod = {
      ...current, scope: 'mes', key: `mes:${current.start.getFullYear()}-${String(current.start.getMonth() + 1).padStart(2, '0')}`,
      label: monthlyLabel(current),
    };
    if (hasStory(movimientos, period)) result.push(period);
  }
  if (now.getMonth() === 0 || now.getMonth() === 11) {
    const year = now.getFullYear() - (now.getMonth() === 0 ? 1 : 0);
    const period: WrappedPeriod = {
      scope: 'anio', key: `anio:${year}`, start: new Date(year, 0, 1),
      end: now.getMonth() === 0 ? new Date(year + 1, 0, 1) : new Date(now), label: String(year),
      ...(now.getMonth() === 11 ? { parcial: true } : {}),
    };
    if (hasStory(movimientos, period)) result.push(period);
  }
  return result;
}

const ANNOUNCE_WINDOW_DAYS = 10;

/**
 * Picks which Wrapped period to announce automatically on the dashboard:
 * - Full annual recap throughout January (takes priority over December's monthly recap).
 * - Just-closed monthly recap during the first 10 days of the new period.
 * - Partial annual recap ("hasta hoy") during December.
 */
export function featuredWrapped(
  movimientos: readonly Movimiento[],
  now = new Date(),
  inicioPeriodo: InicioPeriodo = 1,
  seenKeys: Iterable<string> = [],
): WrappedPeriod | null {
  const seen = new Set(seenKeys);
  const periods = availableWrappeds(movimientos, now, inicioPeriodo);

  if (now.getMonth() === 0) {
    const annual = periods.find(p => p.scope === 'anio' && !p.parcial && !seen.has(p.key));
    if (annual) return annual;
  }

  const monthly = periods.find(p => {
    if (p.scope !== 'mes' || seen.has(p.key)) return false;
    const closedAt = day(p.end);
    const limit = new Date(closedAt.getFullYear(), closedAt.getMonth(), closedAt.getDate() + ANNOUNCE_WINDOW_DAYS);
    return now >= closedAt && now < limit;
  });
  if (monthly) return monthly;

  if (now.getMonth() === 11) {
    const partial = periods.find(p => p.scope === 'anio' && Boolean(p.parcial) && !seen.has(p.key));
    if (partial) return partial;
  }

  return null;
}
