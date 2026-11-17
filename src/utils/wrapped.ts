import type { Movimiento } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { categoryLabel as defaultCategoryLabel } from './movementSuggestions';
import { groupExpensesByCategory, parseMovimientoDate, type CategoryExpense } from './periodStats';
import { payrollDates, periodName, periodOf, previousPeriod, type InicioPeriodo, type Period } from './periods';
import { normalizeServiceName, resolveServiceKey } from './serviceNames';
import { summarizeSmallPurchases, type SmallPurchasesSummary } from './smallPurchases';

export type WrappedScope = 'mes' | 'anio';
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
export type WrappedTone = 'rose' | 'sky' | 'violet' | 'amber' | 'emerald' | 'fuchsia' | 'teal' | 'indigo';
export type WrappedIcon = 'trend-up' | 'trend-down' | 'coffee' | 'calendar' | 'store' | 'sparkles' | 'repeat' | 'moon' | 'tag' | 'receipt';
/**
 * One card of the Wrapped inventory. `especial` cards have their own screen
 * (categories, merchants, rhythm, biggest purchase, streak); the rest share a
 * generic layout built from `eyebrow`, `titulo` and `detalle`.
 */
export interface WrappedHighlight {
  id: string;
  /** 0–100: how striking this card is for this period. */
  score: number;
  especial?: boolean;
  /** Cards telling the same story share a group; a Wrapped shows one per group. */
  grupo?: string;
  eyebrow?: string;
  titulo?: string;
  detalle?: string;
  tono?: WrappedTone;
  icono?: WrappedIcon;
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
export interface WrappedMerchant { nombre: string; key: string; visitas: number; total: number }
export interface WrappedCategory extends CategoryExpense { label: string }
export interface WrappedPurchase { concepto: string; importe: number; fecha: Date }
export interface WrappedDay { fecha: Date; total: number }
export interface WrappedMonth { mes: number; total: number }
export interface WrappedWeekday { dia: number; porcentaje: number }
export interface WrappedStreak { dias: number; desde: Date | null; hasta: Date | null }
export interface WrappedPersonality { titulo: string; descripcion: string }
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
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const nextDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
const monthName = (date: Date) => date.toLocaleDateString('es-ES', { month: 'long' });
const natural = (period: Period) => period.start.getDate() === 1 && period.end.getDate() === 1;
const monthlyLabel = (period: Period) => natural(period) ? monthName(period.start) : periodName(period);
const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

interface Entry { movement: Movimiento; fecha: Date; cents: number }
function entries(movimientos: readonly Movimiento[], period: Period): Entry[] {
  return movimientos.flatMap(movement => {
    if (!cuentaEnEstadisticas(movement)) return [];
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    if (!fecha || fecha < period.start || fecha >= period.end) return [];
    const cents = Math.round(importeEnEstadisticas(movement) * 100);
    return Number.isFinite(cents) && cents > 0 ? [{ movement, fecha, cents }] : [];
  });
}
const sum = (rows: Entry[]) => rows.reduce((total, row) => total + row.cents, 0) / 100;

// Bank suffixes commonly start with a terminal/reference number and include a city.
// Keep the merchant prefix, removing loose reference tokens rather than merging them.
function merchantKey(concepto: string): string {
  return resolveServiceKey(concepto) ?? normalizeServiceName(concepto)
    .split(/(?:^|\s)\S*\d/)[0].replace(/\b(?:ref|referencia)\b.*$/, '').trim();
}

const personalities: Record<string, [string, string]> = {
  alimentacion: ['Chef de casa', 'Tu cocina tiene un ingrediente estrella: tú.'],
  restaurantes: ['Foodie', 'Siempre hay una mesa nueva que descubrir.'],
  ocio: ['Alma de la fiesta', 'Sabes convertir los planes en buenos recuerdos.'],
  transporte: ['Siempre en ruta', 'Lo tuyo es seguir descubriendo caminos.'],
  compras: ['Cazador de caprichos', 'Tienes buen ojo para darte una alegría.'],
  tecnologia: ['Geek', 'Tu próxima actualización siempre está cerca.'],
  salud: ['Modo bienestar', 'Cuidarte es uno de tus mejores planes.'],
  formacion: ['Eterno aprendiz', 'Tu curiosidad sigue sumando nuevas ideas.'],
  inversion: ['Futuro rentista', 'Hoy plantas semillas para tu yo del futuro.'],
};

const WEEKDAY_PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
const clamp = (value: number, max = 100) => Math.max(0, Math.min(max, Math.round(value)));
// Display order: the story flows from where the money went to the habits behind it.
const STORY_ORDER = [
  'categoria-sube', 'categoria-baja', 'comercios', 'comercio-ausente', 'comercios-nuevos',
  'ritmo', 'compra-mayor', 'dia-semana', 'finde', 'pequenas', 'cafes', 'ticket-medio', 'suscripciones',
  'racha', 'dias-sin-gastar', 'primer-gasto',
];

interface InventoryInput {
  period: WrappedPeriod;
  expenses: Entry[];
  previousExpenses: Entry[];
  gastos: number;
  gastosAnterior: number;
  categories: CategoryExpense[];
  merchantList: WrappedMerchant[];
  comercioFavorito: WrappedMerchant | null;
  largestCents: number;
  largestConcepto: string;
  rachaSinGastos: WrappedStreak;
  elapsedDays: number;
  daily: Map<number, number>;
  monthly: number[];
  weekdays: number[];
  pequenas: SmallPurchasesSummary;
  suscripciones: number;
  previousLabel: string;
  categoryLabel: (id: string) => string;
}

/**
 * The full pool of cards a Wrapped can show. Each card scores how striking
 * it is for this period, so a quiet stat never pushes out a surprising one.
 */
export function buildInventory(input: InventoryInput): WrappedHighlight[] {
  const {
    period, expenses, previousExpenses, gastos, categories, merchantList, comercioFavorito,
    largestCents, largestConcepto, rachaSinGastos, elapsedDays, daily, monthly, weekdays, pequenas, suscripciones,
    previousLabel, categoryLabel,
  } = input;
  const cards: WrappedHighlight[] = [];
  const total = gastos * 100;
  const isMonth = period.scope === 'mes';
  const unit = isMonth ? 'este mes' : 'este año';

  // Bespoke screens.
  if (comercioFavorito) {
    cards.push({ id: 'comercios', especial: true, score: clamp(30 + comercioFavorito.visitas * 3, 90) });
  }
  const elapsedBuckets = isMonth ? Math.max(1, elapsedDays) : Math.max(1, monthly.filter(v => v > 0).length);
  const peakCents = isMonth ? Math.max(0, ...daily.values()) : Math.max(...monthly);
  const peakRatio = total > 0 ? peakCents / (total / elapsedBuckets) : 0;
  cards.push({ id: 'ritmo', especial: true, score: clamp(10 + (peakRatio - 1) * (isMonth ? 4 : 15), 80) });
  cards.push({ id: 'compra-mayor', especial: true, score: clamp(20 + (total > 0 ? largestCents / total * 150 : 0), 90) });
  if (rachaSinGastos.dias >= 2) cards.push({ id: 'racha', especial: true, grupo: 'sin-gasto', score: clamp(rachaSinGastos.dias * 8, 85) });

  // Generic cards.
  // The month-on-month comparison lives on the fixed "gasto total" screen, so it is not a card.

  const previousCategories = new Map(groupExpensesByCategory(previousExpenses.map(row => row.movement), m => m.categoria || m.categoria_sugerida)
    .map(c => [c.categoria, c.total]));
  if (previousCategories.size) {
    const changes = categories.map(c => ({ ...c, antes: previousCategories.get(c.categoria) ?? 0 }))
      .concat([...previousCategories].filter(([id]) => !categories.some(c => c.categoria === id)).map(([categoria, antes]) => ({ categoria, total: 0, porcentaje: 0, antes })))
      .filter(c => c.categoria !== 'sin_categoria' && c.antes > 0)
      .map(c => ({ ...c, diff: c.total - c.antes, pct: (c.total - c.antes) / c.antes * 100 }));
    const up = changes.filter(c => c.diff >= 20 && c.pct >= 30).sort((a, b) => b.diff - a.diff)[0];
    if (up) {
      cards.push({
        id: 'categoria-sube', score: clamp(35 + Math.min(50, up.pct / 3)), tono: 'amber', icono: 'trend-up',
        eyebrow: 'La que más creció', titulo: categoryLabel(up.categoria),
        detalle: `Subió un ${Math.round(up.pct)} % frente a ${previousLabel}: ${money.format(up.antes)} → ${money.format(up.total)}.`,
      });
    }
    const down = changes.filter(c => c.diff <= -20 && c.pct <= -30).sort((a, b) => a.diff - b.diff)[0];
    if (down) {
      cards.push({
        id: 'categoria-baja', score: clamp(35 + Math.min(50, -down.pct / 3)), tono: 'emerald', icono: 'trend-down',
        eyebrow: 'La que más bajó', titulo: categoryLabel(down.categoria),
        detalle: down.total === 0
          ? `En ${previousLabel} fueron ${money.format(down.antes)}; ${unit}, ni un euro.`
          : `Bajó un ${Math.round(-down.pct)} % frente a ${previousLabel}: ${money.format(down.antes)} → ${money.format(down.total)}.`,
      });
    }
  }

  const previousMerchants = new Map<string, { nombre: string; visitas: number }>();
  for (const { movement } of previousExpenses) {
    if (movement.suscripcion_id || movement.categoria === 'nomina') continue;
    const key = merchantKey(movement.concepto);
    if (key.length < 3 || !/[a-z]{3}/.test(key)) continue;
    const entry = previousMerchants.get(key) ?? { nombre: movement.concepto, visitas: 0 };
    entry.visitas++;
    previousMerchants.set(key, entry);
  }
  if (previousMerchants.size) {
    const current = new Set(merchantList.map(m => m.key));
    const missing = [...previousMerchants].filter(([key, m]) => !current.has(key) && m.visitas >= 3)
      .map(([, m]) => m).sort((a, b) => b.visitas - a.visitas)[0];
    if (missing) {
      cards.push({
        id: 'comercio-ausente', score: clamp(40 + missing.visitas * 4, 90), tono: 'sky', icono: 'store',
        eyebrow: 'Te echan de menos', titulo: missing.nombre,
        detalle: `En ${previousLabel} fuiste ${missing.visitas} veces y ${unit} ninguna.`,
      });
    }
    const nuevos = merchantList.filter(m => !previousMerchants.has(m.key));
    if (nuevos.length >= 2) {
      const best = [...nuevos].sort((a, b) => b.total - a.total)[0];
      cards.push({
        id: 'comercios-nuevos', score: clamp(20 + nuevos.length * 3, 70), tono: 'sky', icono: 'sparkles',
        eyebrow: 'Explorador', titulo: `${nuevos.length} sitios nuevos`,
        detalle: `Estrenaste ${nuevos.length} comercios ${unit}. El que más te gustó: ${best.nombre} (${money.format(best.total)}).`,
      });
    }
  }

  const favoriteDay = weekdays.indexOf(Math.max(...weekdays));
  const dayPct = total > 0 ? weekdays[favoriteDay] / total * 100 : 0;
  if (dayPct >= 22) {
    cards.push({
      id: 'dia-semana', grupo: 'semana', score: clamp(dayPct * 1.6, 85), tono: 'violet', icono: 'calendar',
      eyebrow: 'Tu día', titulo: `Los ${WEEKDAY_PLURAL[favoriteDay]}`,
      detalle: `Se llevaron el ${Math.round(dayPct)} % de todo tu gasto.`,
    });
  }
  const weekendPct = total > 0 ? (weekdays[5] + weekdays[6]) / total * 100 : 0;
  if (weekendPct >= 40 || (weekendPct <= 12 && expenses.length >= 10)) {
    const heavy = weekendPct >= 40;
    cards.push({
      id: 'finde', grupo: 'semana', score: clamp(heavy ? weekendPct : 70 - weekendPct * 2, 80), tono: heavy ? 'fuchsia' : 'teal', icono: 'moon',
      eyebrow: heavy ? 'Modo finde' : 'Finde tranquilo', titulo: `${Math.round(weekendPct)} % en fin de semana`,
      detalle: heavy
        ? 'Sábados y domingos concentran casi la mitad de tu gasto.'
        : 'Tus fines de semana apenas tocan la cartera.',
    });
  }

  if (pequenas.count >= 5) {
    cards.push({
      id: 'pequenas', grupo: 'pequenas', score: clamp(25 + pequenas.count * 1.5, 80), tono: 'amber', icono: 'coffee',
      eyebrow: 'Gota a gota', titulo: `${pequenas.count} compras pequeñas`,
      detalle: `Todas de menos de 5 €, pero juntas suman ${money.format(pequenas.total)}.`,
    });
    const cafes = Math.floor(pequenas.total / 1.5);
    if (cafes >= 10) {
      cards.push({
        id: 'cafes', grupo: 'pequenas', score: 18, tono: 'amber', icono: 'coffee',
        eyebrow: 'Puesto en perspectiva', titulo: `${cafes} cafés`,
        detalle: `Es lo que pagarías con tus compras pequeñas, a 1,50 € el café.`,
      });
    }
  }

  if (expenses.length >= 8) {
    const avg = gastos / expenses.length;
    const prevAvg = previousExpenses.length ? sum(previousExpenses) / previousExpenses.length : 0;
    const change = prevAvg > 0 ? (avg - prevAvg) / prevAvg * 100 : 0;
    cards.push({
      id: 'ticket-medio', score: clamp(12 + Math.min(40, Math.abs(change) / 2), 55), tono: 'indigo', icono: 'receipt',
      eyebrow: 'Ticket medio', titulo: money.format(avg),
      detalle: prevAvg > 0 && Math.abs(change) >= 10
        ? `Un ${Math.round(Math.abs(change))} % ${change < 0 ? 'menos' : 'más'} por compra que en ${previousLabel}.`
        : `Es lo que gastaste de media en cada una de tus ${expenses.length} compras.`,
    });
  }

  if (suscripciones > 0 && gastos > 0) {
    const pct = suscripciones / gastos * 100;
    cards.push({
      id: 'suscripciones', score: clamp(15 + pct * 2, 70), tono: 'rose', icono: 'repeat',
      eyebrow: 'En piloto automático', titulo: money.format(suscripciones),
      detalle: `Se fueron en suscripciones: el ${Math.round(pct)} % de tu gasto ${unit}.`,
    });
  }

  if (isMonth && elapsedDays > 0) {
    const sinGasto = [...Array(elapsedDays).keys()].filter(i => {
      const date = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i);
      return !daily.get(+date);
    }).length;
    if (sinGasto >= 4) {
      cards.push({
        id: 'dias-sin-gastar', grupo: 'sin-gasto', score: clamp(sinGasto / elapsedDays * 120, 75), tono: 'teal', icono: 'sparkles',
        eyebrow: 'Días en cero', titulo: `${sinGasto} días`,
        detalle: `Sin un solo gasto. Tu cartera también descansa.`,
      });
    }
  }

  const first = [...expenses].sort((a, b) => +a.fecha - +b.fecha)[0];
  if (first && first.movement.concepto !== largestConcepto) {
    cards.push({
      id: 'primer-gasto', score: 10, tono: 'indigo', icono: 'tag',
      eyebrow: isMonth ? 'Así empezó el mes' : 'Así empezó el año', titulo: first.movement.concepto,
      detalle: `Tu primer gasto fue el ${first.fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: ${money.format(first.cents / 100)}.`,
    });
  }

  return cards.sort((a, b) => b.score - a.score || STORY_ORDER.indexOf(a.id) - STORY_ORDER.indexOf(b.id));
}

/**
 * Picks the `max` most striking cards. Cards that led the previous Wrapped
 * lose 40 % of their score, so consecutive months rarely look the same.
 * The result follows the story order, not the score order.
 */
export function selectHighlights(inventario: readonly WrappedHighlight[], max: number, previous: readonly string[] = []): string[] {
  const shown = new Set(previous);
  const groups = new Set<string>();
  const picked: string[] = [];
  const ranked = [...inventario]
    .map(card => ({ card, score: shown.has(card.id) ? card.score * 0.6 : card.score }))
    .sort((a, b) => b.score - a.score || STORY_ORDER.indexOf(a.card.id) - STORY_ORDER.indexOf(b.card.id));
  for (const { card } of ranked) {
    if (picked.length >= max) break;
    if (card.grupo && groups.has(card.grupo)) continue;
    if (card.grupo) groups.add(card.grupo);
    picked.push(card.id);
  }
  return picked.sort((a, b) => STORY_ORDER.indexOf(a) - STORY_ORDER.indexOf(b));
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
  for (const { movement, fecha, cents } of expenses) {
    const date = day(fecha);
    daily.set(+date, (daily.get(+date) ?? 0) + cents);
    const weekday = (fecha.getDay() + 6) % 7;
    weekdays[weekday] += cents;
    date.setDate(date.getDate() - weekday);
    weekly.set(+date, (weekly.get(+date) ?? 0) + cents);
    monthly[fecha.getMonth()] += cents;
    if (movement.suscripcion_id || movement.categoria === 'nomina') continue;
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
  const largest = [...expenses].sort((a, b) => b.cents - a.cents || +a.fecha - +b.fecha)[0];
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
    if (total > 0) { streakStart = null; streakLength = 0; continue; }
    streakStart ??= date;
    streakLength++;
    if (streakLength > rachaSinGastos.dias) rachaSinGastos = { dias: streakLength, desde: streakStart, hasta: date };
  }
  const months = monthly.map((total, mes) => ({ mes, total: total / 100 }));
  // Empty elapsed months participate; future months cannot be the cheapest month.
  const elapsedMonths = months.filter(({ mes }) => new Date(period.start.getFullYear(), mes, 1) < period.end && new Date(period.start.getFullYear(), mes, 1) <= now);
  const week = [...weekly].sort(([a, x], [b, y]) => y - x || a - b)[0];
  const favoriteDay = weekdays.indexOf(Math.max(...weekdays));
  const diaSemanaFavorito = { dia: favoriteDay, porcentaje: round(weekdays[favoriteDay] / (gastos * 100) * 100) };
  const nominas = payrollDates(movimientos);
  const payrollPeriod = nominas.some(date => +date === +period.start) && nominas.some(date => +date === +period.end);
  const previous = opts.previous ?? (period.scope === 'anio'
    // A partial year ("hasta hoy") is compared with the same span of the previous year.
    ? { start: new Date(period.start.getFullYear() - 1, 0, 1), end: new Date(period.end.getFullYear() - 1, period.end.getMonth(), period.end.getDate()) }
    : previousPeriod(period, payrollPeriod ? 'nomina' : period.start.getDate(), nominas));
  const gastosAnterior = sum(entries(movimientos, previous).filter(row => row.movement.tipo === 'gasto'));
  const comparativa = gastosAnterior > 0 ? { gastosAnterior, deltaPct: round((gastos - gastosAnterior) / gastosAnterior * 100) } : null;
  const pequenas = summarizeSmallPurchases(expenses.map(({ movement }) => movement), 5);
  const personalityCategory = categories.find(c => c.categoria !== 'vivienda') ?? categories[0];
  const [titulo, descripcion] = tasaAhorro !== null && tasaAhorro >= 30
    ? ['Hormiguita', 'Paso a paso, tu colchón sigue creciendo.']
    : personalities[personalityCategory?.categoria] ?? ['Equilibrista', 'Sabes encontrar tu propio equilibrio entre tantos planes.'];
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
  const inventario = buildInventory({
    period, expenses, previousExpenses, gastos, gastosAnterior, categories, merchantList,
    comercioFavorito, largestCents: largest.cents, largestConcepto: largest.movement.concepto, rachaSinGastos, elapsedDays,
    daily, monthly, weekdays, pequenas, suscripciones: sum(expenses.filter(row => Boolean(row.movement.suscripcion_id))),
    previousLabel: period.scope === 'anio' ? String(previous.start.getFullYear()) : monthlyLabel(previous),
    categoryLabel: opts.categoryLabel ?? defaultCategoryLabel,
  });
  // Rotate: a card that led last period's Wrapped weighs less now, so each month tells something new.
  // The previous Wrapped is itself rotated against the one before, a few levels deep, so the
  // penalty hits what was really shown and months do not just alternate between two picks.
  const depth = opts.rotacion ?? 3;
  const previousTop = depth <= 0 || period.parcial
    ? []
    : buildWrapped(movimientos, { ...period, ...previous, key: `${period.key}:prev` }, { ...opts, previous: undefined, now, rotacion: depth - 1 })?.destacados ?? [];
  const destacados = selectHighlights(inventario, period.scope === 'anio' ? 7 : 5, previousTop);
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
    inventario, destacados,
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
