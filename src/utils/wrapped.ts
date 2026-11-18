import type { Movimiento } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { categoryLabel as defaultCategoryLabel } from './movementSuggestions';
import { groupExpensesByCategory, parseMovimientoDate, type CategoryExpense } from './periodStats';
import { payrollDates, periodName, periodOf, previousPeriod, type InicioPeriodo, type Period } from './periods';
import { normalizeServiceName, resolveServiceKey } from './serviceNames';
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
const monthlyLabel = (period: Period) => natural(period) ? monthName(period.start) : periodName(period);
const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

type Entry = InsightEntry;
function entries(movimientos: readonly Movimiento[], period: Period): Entry[] {
  return movimientos.flatMap(movement => {
    if (!cuentaEnEstadisticas(movement)) return [];
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    if (!fecha || fecha < period.start || fecha >= period.end) return [];
    const cents = Math.round(importeEnEstadisticas(movement) * 100);
    return Number.isFinite(cents) && cents > 0 ? [{ movement, fecha, cents }] : [];
  });
}
const isFixedExpense = (m: Movimiento) => Boolean(m.suscripcion_id) || m.categoria === 'vivienda';
const sum = (rows: Entry[]) => rows.reduce((total, row) => total + row.cents, 0) / 100;

// Bank suffixes commonly start with a terminal/reference number and include a city.
// Keep the merchant prefix, removing loose reference tokens rather than merging them.
function merchantKey(concepto: string): string {
  return resolveServiceKey(concepto) ?? normalizeServiceName(concepto)
    .split(/(?:^|\s)\S*\d/)[0].replace(/\b(?:ref|referencia)\b.*$/, '').trim();
}

const HIGHLIGHTS_MONTH = 7;
const HIGHLIGHTS_YEAR = 10;
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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
        corto: period.scope === 'anio' ? String(current.start.getFullYear()) : SHORT_MONTHS[current.start.getMonth()],
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
  if (expenses.length < 5) return null;
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
  const nominas = payrollDates(movimientos);
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

/** Completed monthly periods (at most eleven), followed by the seasonal annual recap. */
export function availableWrappeds(
  movimientos: readonly Movimiento[], now = new Date(), inicioPeriodo: InicioPeriodo = 1,
): WrappedPeriod[] {
  const nominas = inicioPeriodo === 'nomina' ? payrollDates(movimientos) : [];
  let current = periodOf(now, inicioPeriodo, nominas);
  const result: WrappedPeriod[] = [];
  for (let i = 0; i < 11; i++) {
    current = previousPeriod(current, inicioPeriodo, nominas);
    const period: WrappedPeriod = {
      ...current, scope: 'mes', key: `mes:${current.start.getFullYear()}-${String(current.start.getMonth() + 1).padStart(2, '0')}`,
      label: monthlyLabel(current),
    };
    if (buildWrapped(movimientos, period, { now, previous: previousPeriod(current, inicioPeriodo, nominas) })) result.push(period);
  }
  if (now.getMonth() === 0 || now.getMonth() === 11) {
    const year = now.getFullYear() - (now.getMonth() === 0 ? 1 : 0);
    const period: WrappedPeriod = {
      scope: 'anio', key: `anio:${year}`, start: new Date(year, 0, 1),
      end: now.getMonth() === 0 ? new Date(year + 1, 0, 1) : new Date(now), label: String(year),
      ...(now.getMonth() === 11 ? { parcial: true } : {}),
    };
    if (buildWrapped(movimientos, period, { now })) result.push(period);
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
