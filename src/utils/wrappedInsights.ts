import type { Movimiento } from '../types';
import type { CategoryExpense } from './periodStats';
import type { SmallPurchasesSummary } from './smallPurchases';

/**
 * The Wrapped insight pool. Every template looks at the period and either
 * says nothing (it does not apply) or returns a card with a score: how
 * striking that fact is this time. `buildWrapped` then keeps a handful of
 * the best ones, penalising what the previous Wrapped already told, so two
 * months rarely tell the same story.
 */

export type WrappedScope = 'mes' | 'anio';
export type WrappedTone = 'rose' | 'sky' | 'violet' | 'amber' | 'emerald' | 'fuchsia' | 'teal' | 'indigo';
export type WrappedIcon =
  | 'trend-up' | 'trend-down' | 'coffee' | 'calendar' | 'store' | 'sparkles' | 'repeat' | 'moon' | 'tag'
  | 'receipt' | 'flame' | 'trophy' | 'compass' | 'heart' | 'zap' | 'utensils' | 'ticket' | 'wallet'
  | 'home' | 'crown' | 'target' | 'clock' | 'bag' | 'chart';
export type WrappedFormat = 'dinero' | 'numero' | 'pct';

/** What a card draws under its headline. Money stays a number so the UI can mask it. */
export type WrappedVisual =
  | { tipo: 'cifra'; valor: number; formato: WrappedFormat; sufijo?: string }
  | { tipo: 'versus'; formato: WrappedFormat; antes: { label: string; valor: number }; ahora: { label: string; valor: number } }
  | { tipo: 'ranking'; formato: WrappedFormat; items: { nombre: string; valor: number; nota?: string }[] }
  | { tipo: 'anillo'; pct: number; etiqueta?: string }
  | { tipo: 'calendario'; inicio: Date; dias: number[]; marcados?: [number, number] }
  | { tipo: 'barras'; valores: number[]; etiquetas: string[]; destacado: number; formato?: WrappedFormat }
  | { tipo: 'iconos'; cantidad: number; icono: WrappedIcon }
  | { tipo: 'comercio'; nombre: string; valor: number; nota?: string };

/**
 * One card of the Wrapped inventory. `especial` cards have their own screen
 * (merchants, rhythm, biggest purchase, streak); the rest share a layout built
 * from `eyebrow`, `titulo`, `visual` and `detalle`.
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
  visual?: WrappedVisual;
}

export interface WrappedMerchant { nombre: string; key: string; visitas: number; total: number }
export interface WrappedStreak { dias: number; desde: Date | null; hasta: Date | null }
export interface InsightEntry { movement: Movimiento; fecha: Date; cents: number }
export interface HistoryPoint { label: string; corto: string; gastos: number; ingresos: number }

export interface InsightContext {
  scope: WrappedScope;
  /** Stable per period: varies the wording and breaks near-ties differently each time. */
  seedKey: string;
  start: Date;
  end: Date;
  expenses: InsightEntry[];
  /** Expenses without rent and subscriptions: what says something about habits. */
  habitRows: InsightEntry[];
  previousExpenses: InsightEntry[];
  incomes: InsightEntry[];
  gastos: number;
  ingresos: number;
  ahorro: number;
  tasaAhorro: number | null;
  gastosAnterior: number;
  categories: CategoryExpense[];
  previousCategories: Map<string, number>;
  merchantList: WrappedMerchant[];
  previousMerchants: Map<string, { nombre: string; visitas: number }>;
  comercioFavorito: WrappedMerchant | null;
  comercioTop: WrappedMerchant | null;
  largest: InsightEntry;
  rachaSinGastos: WrappedStreak;
  elapsedDays: number;
  daily: Map<number, number>;
  spendDays: Set<number>;
  monthly: number[];
  weekdays: number[];
  pequenas: SmallPurchasesSummary;
  suscripciones: number;
  /** Earlier periods with data, oldest first (up to six months, or previous years). */
  historia: HistoryPoint[];
  label: string;
  previousLabel: string;
  categoryLabel: (id: string) => string;
  merchantKey: (concepto: string) => string;
}

const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmt = (value: number) => money.format(value);
const clamp = (value: number, max = 100) => Math.max(0, Math.min(max, Math.round(value)));
const sumCents = (rows: InsightEntry[]) => rows.reduce((total, row) => total + row.cents, 0);
const dayKey = (date: Date) => +new Date(date.getFullYear(), date.getMonth(), date.getDate());
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const WEEKDAY_PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
const WEEKDAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** FNV-1a, mapped to [0, 1). Deterministic, so replaying a Wrapped shows the same thing. */
export function seeded(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}
const pick = <T,>(key: string, options: readonly T[]): T => options[Math.floor(seeded(key) * options.length)];

type Template = (ctx: InsightContext) => WrappedHighlight | WrappedHighlight[] | null | undefined | false;

/** Fun equivalences for a category total: [category, unit price, singular, plural, icon]. */
const EQUIVALENCES: [string, number, string, string, WrappedIcon][] = [
  ['restaurantes', 13, 'menú del día', 'menús del día', 'utensils'],
  ['ocio', 9, 'entrada de cine', 'entradas de cine', 'ticket'],
  ['transporte', 1.5, 'viaje en metro', 'viajes en metro', 'compass'],
  ['alimentacion', 1.2, 'barra de pan', 'barras de pan', 'bag'],
  ['compras', 20, 'camiseta', 'camisetas', 'bag'],
  ['tecnologia', 25, 'funda de móvil', 'fundas de móvil', 'zap'],
];

const TEMPLATES: Template[] = [
  // ── Where the money went ────────────────────────────────────────────────
  ctx => ctx.categories.length >= 2 && {
    id: 'categorias', grupo: 'categorias', especial: true,
    score: clamp(40 + ctx.categories[0].porcentaje / 3, 70),
  },
  ctx => {
    const top = ctx.categories.find(c => c.categoria !== 'vivienda' && c.categoria !== 'sin_categoria');
    if (!top || top.porcentaje < 18) return null;
    const share = Math.max(2, Math.round(100 / top.porcentaje));
    return {
      id: 'categoria-reina', grupo: 'categorias', tono: 'violet', icono: 'crown',
      score: clamp(25 + top.porcentaje, 75),
      eyebrow: pick(`${ctx.seedKey}:reina`, ['Categoría reina', 'Tu debilidad', 'Donde más se notó']),
      titulo: ctx.categoryLabel(top.categoria),
      visual: { tipo: 'anillo', pct: top.porcentaje, etiqueta: 'de tu gasto' },
      detalle: `1 de cada ${share} euros que gastaste fue a ${ctx.categoryLabel(top.categoria).toLowerCase()}: ${fmt(top.total)}.`,
    };
  },
  ctx => {
    if (!ctx.previousCategories.size) return null;
    const changes = ctx.categories.map(c => ({ ...c, antes: ctx.previousCategories.get(c.categoria) ?? 0 }))
      .concat([...ctx.previousCategories].filter(([id]) => !ctx.categories.some(c => c.categoria === id))
        .map(([categoria, antes]) => ({ categoria, total: 0, porcentaje: 0, antes })))
      .filter(c => c.categoria !== 'sin_categoria' && c.antes > 0)
      .map(c => ({ ...c, diff: c.total - c.antes, pct: (c.total - c.antes) / c.antes * 100 }));
    const cards: WrappedHighlight[] = [];
    const up = changes.filter(c => c.diff >= 20 && c.pct >= 30).sort((a, b) => b.diff - a.diff)[0];
    if (up) {
      cards.push({
        id: 'categoria-sube', score: clamp(35 + Math.min(50, up.pct / 3)), tono: 'amber', icono: 'trend-up',
        eyebrow: 'La que más creció', titulo: ctx.categoryLabel(up.categoria),
        visual: { tipo: 'versus', formato: 'dinero', antes: { label: ctx.previousLabel, valor: up.antes }, ahora: { label: ctx.label, valor: up.total } },
        detalle: `Subió un ${Math.round(up.pct)} % frente a ${ctx.previousLabel}: ${fmt(up.antes)} → ${fmt(up.total)}.`,
      });
    }
    const down = changes.filter(c => c.diff <= -20 && c.pct <= -30).sort((a, b) => a.diff - b.diff)[0];
    if (down) {
      cards.push({
        id: 'categoria-baja', score: clamp(35 + Math.min(50, -down.pct / 3)), tono: 'emerald', icono: 'trend-down',
        eyebrow: 'La que más bajó', titulo: ctx.categoryLabel(down.categoria),
        visual: { tipo: 'versus', formato: 'dinero', antes: { label: ctx.previousLabel, valor: down.antes }, ahora: { label: ctx.label, valor: down.total } },
        detalle: down.total === 0
          ? `En ${ctx.previousLabel} fueron ${fmt(down.antes)}; ${unit(ctx)}, ni un euro.`
          : `Bajó un ${Math.round(-down.pct)} % frente a ${ctx.previousLabel}: ${fmt(down.antes)} → ${fmt(down.total)}.`,
      });
    }
    return cards;
  },
  ctx => {
    if (!ctx.previousCategories.size) return null;
    const fresh = ctx.categories.filter(c => c.categoria !== 'sin_categoria' && !ctx.previousCategories.has(c.categoria) && c.total >= 30)
      .sort((a, b) => b.total - a.total)[0];
    return fresh && {
      id: 'categoria-nueva', tono: 'sky', icono: 'sparkles', score: clamp(30 + fresh.porcentaje * 2, 70),
      eyebrow: 'Estreno', titulo: ctx.categoryLabel(fresh.categoria),
      visual: { tipo: 'cifra', valor: fresh.total, formato: 'dinero' },
      detalle: `En ${ctx.previousLabel} no gastaste nada aquí. ${cap(unit(ctx))} sí.`,
    };
  },
  ctx => {
    const home = ctx.categories.find(c => c.categoria === 'vivienda');
    return home && home.porcentaje >= 25 && {
      id: 'vivienda', tono: 'indigo', icono: 'home', score: clamp(home.porcentaje / 3, 30),
      eyebrow: 'Hogar, dulce hogar', titulo: `${Math.round(home.porcentaje)} % para tu casa`,
      visual: { tipo: 'anillo', pct: home.porcentaje, etiqueta: 'vivienda' },
      detalle: `Alquiler, luz y compañía se llevaron ${fmt(home.total)}. Lo demás fue tuyo.`,
    };
  },
  ctx => {
    for (const [categoria, price, one, many, icono] of [...EQUIVALENCES].sort((a, b) => seeded(`${ctx.seedKey}:eq:${a[0]}`) - seeded(`${ctx.seedKey}:eq:${b[0]}`))) {
      const total = ctx.categories.find(c => c.categoria === categoria)?.total ?? 0;
      const count = Math.floor(total / price);
      if (count < 5) continue;
      return {
        id: 'equivalencia', grupo: 'pequenas', tono: 'fuchsia', icono, score: clamp(28 + Math.min(20, count / 4), 48),
        eyebrow: 'Puesto en perspectiva', titulo: plural(count, one, many),
        visual: { tipo: 'iconos', cantidad: count, icono },
        detalle: `Es lo que suman tus ${fmt(total)} en ${ctx.categoryLabel(categoria).toLowerCase()}, a ${fmt(price)} cada uno.`,
      };
    }
    return null;
  },

  // ── Where you went ──────────────────────────────────────────────────────
  ctx => ctx.comercioFavorito && {
    id: 'comercios', grupo: 'favorito', especial: true, score: clamp(30 + ctx.comercioFavorito.visitas * 3, 85),
  },
  ctx => {
    const podium = [...ctx.merchantList].sort((a, b) => b.visitas - a.visitas || b.total - a.total).slice(0, 3);
    if (podium.length < 3 || podium[2].visitas < 2) return null;
    return {
      id: 'podio', grupo: 'favorito', tono: 'sky', icono: 'trophy', score: clamp(30 + podium[0].visitas * 2, 78),
      eyebrow: 'Tu podio', titulo: 'Los sitios que más pisaste',
      visual: { tipo: 'ranking', formato: 'numero', items: podium.map(m => ({ nombre: m.nombre, valor: m.visitas, nota: fmt(m.total) })) },
    };
  },
  ctx => {
    if (ctx.merchantList.length < 5) return null;
    const visits = ctx.merchantList.reduce((a, m) => a + m.visitas, 0);
    const top3 = [...ctx.merchantList].sort((a, b) => b.visitas - a.visitas).slice(0, 3).reduce((a, m) => a + m.visitas, 0);
    const pct = visits ? top3 / visits * 100 : 0;
    if (pct < 45 || visits < 10) return null;
    return {
      id: 'fidelidad', grupo: 'favorito', tono: 'rose', icono: 'heart', score: clamp(pct * 0.8, 70),
      eyebrow: 'De costumbres fijas', titulo: 'Tus tres sitios de siempre',
      visual: { tipo: 'anillo', pct, etiqueta: 'en 3 sitios' },
      detalle: `El ${Math.round(pct)} % de tus compras fue allí. Para qué cambiar si funciona.`,
    };
  },
  ctx => {
    if (!ctx.previousMerchants.size) return null;
    const current = new Set(ctx.merchantList.map(m => m.key));
    const missing = [...ctx.previousMerchants].filter(([key, m]) => !current.has(key) && m.visitas >= 3)
      .map(([, m]) => m).sort((a, b) => b.visitas - a.visitas)[0];
    return missing && {
      id: 'comercio-ausente', score: clamp(40 + missing.visitas * 4, 90), tono: 'sky', icono: 'store',
      eyebrow: 'Te echan de menos', titulo: missing.nombre,
      visual: { tipo: 'versus', formato: 'numero', antes: { label: ctx.previousLabel, valor: missing.visitas }, ahora: { label: ctx.label, valor: 0 } },
      detalle: `En ${ctx.previousLabel} fuiste ${missing.visitas} veces y ${unit(ctx)} ninguna.`,
    };
  },
  ctx => {
    if (!ctx.previousMerchants.size) return null;
    const nuevos = ctx.merchantList.filter(m => !ctx.previousMerchants.has(m.key));
    if (nuevos.length < 2) return null;
    const best = [...nuevos].sort((a, b) => b.total - a.total)[0];
    return {
      id: 'comercios-nuevos', grupo: 'explorar', score: clamp(20 + nuevos.length * 3, 70), tono: 'sky', icono: 'compass',
      eyebrow: 'Explorador', titulo: `${nuevos.length} sitios nuevos`,
      visual: { tipo: 'cifra', valor: nuevos.length, formato: 'numero', sufijo: 'estrenos' },
      detalle: `Estrenaste ${nuevos.length} comercios ${unit(ctx)}. El que más te gustó: ${best.nombre} (${fmt(best.total)}).`,
    };
  },
  ctx => {
    const candidates = ctx.merchantList.filter(m => m.visitas >= 2).map(m => ({ ...m, avg: m.total / m.visitas }));
    const best = candidates.sort((a, b) => b.avg - a.avg)[0];
    if (!best || best.avg < 25 || best.key === ctx.comercioTop?.key || best.key === ctx.comercioFavorito?.key) return null;
    return {
      id: 'comercio-caro', tono: 'amber', icono: 'receipt', score: clamp(20 + best.avg / 4, 55),
      eyebrow: 'Cada visita cuenta', titulo: best.nombre,
      visual: { tipo: 'cifra', valor: best.avg, formato: 'dinero', sufijo: 'por visita' },
      detalle: `Fuiste ${best.visitas} veces y nunca saliste barato: ${fmt(best.total)} en total.`,
    };
  },
  ctx => {
    const byDay = new Map<string, number>();
    for (const { movement, fecha } of ctx.habitRows) {
      const key = `${dayKey(fecha)}|${ctx.merchantKey(movement.concepto)}`;
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const repeats = [...byDay.values()].filter(n => n >= 2).length;
    return repeats >= 2 && {
      id: 'doble-visita', grupo: 'explorar', tono: 'teal', icono: 'repeat', score: clamp(20 + repeats * 6, 60),
      eyebrow: '¿Se te olvidó algo?', titulo: 'Dos veces el mismo día',
      visual: { tipo: 'cifra', valor: repeats, formato: 'numero', sufijo: repeats === 1 ? 'día repetido' : 'días repetidos' },
      detalle: `Te pasó ${plural(repeats, 'vez', 'veces')}: volver al mismo sitio el mismo día. Clásico.`,
    };
  },

  // ── When you spent ──────────────────────────────────────────────────────
  ctx => ({
    id: 'ritmo', grupo: 'pico', especial: true, score: peakScore(ctx),
  }),
  ctx => {
    if (ctx.scope !== 'mes') return null;
    const weekly = new Map<number, number>();
    for (const { fecha, cents } of ctx.habitRows) {
      const monday = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() - (fecha.getDay() + 6) % 7);
      weekly.set(+monday, (weekly.get(+monday) ?? 0) + cents);
    }
    const weeks = [...weekly].sort(([a], [b]) => a - b);
    if (weeks.length < 3) return null;
    const max = Math.max(...weeks.map(([, v]) => v));
    const best = weeks.findIndex(([, v]) => v === max);
    const share = max / Math.max(1, sumCents(ctx.habitRows)) * 100;
    const monday = new Date(weeks[best][0]);
    return {
      id: 'semana', grupo: 'pico', tono: 'amber', icono: 'flame', score: clamp(share * 1.1, 65),
      eyebrow: 'Tu semana más intensa', titulo: `La del ${monday.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`,
      visual: { tipo: 'barras', valores: weeks.map(([, v]) => v / 100), etiquetas: weeks.map((_, i) => `S${i + 1}`), destacado: best, formato: 'dinero' },
      detalle: `Se llevó el ${Math.round(share)} % de tu gasto del día a día: ${fmt(max / 100)}.`,
    };
  },
  ctx => {
    const total = ctx.weekdays.reduce((a, b) => a + b, 0);
    const favorite = ctx.weekdays.indexOf(Math.max(...ctx.weekdays));
    const pct = total > 0 ? ctx.weekdays[favorite] / total * 100 : 0;
    return pct >= 22 && {
      id: 'dia-semana', grupo: 'semana', score: clamp(pct * 1.6, 85), tono: 'violet', icono: 'calendar',
      eyebrow: 'Tu día', titulo: `Los ${WEEKDAY_PLURAL[favorite]}`,
      visual: { tipo: 'barras', valores: ctx.weekdays.map(v => v / 100), etiquetas: WEEKDAY_SHORT, destacado: favorite, formato: 'dinero' },
      detalle: `Se llevaron el ${Math.round(pct)} % de tu gasto del día a día (sin alquiler ni suscripciones).`,
    };
  },
  ctx => {
    const total = ctx.weekdays.reduce((a, b) => a + b, 0);
    const pct = total > 0 ? (ctx.weekdays[5] + ctx.weekdays[6]) / total * 100 : 0;
    if (!(pct >= 40 || (pct <= 12 && ctx.expenses.length >= 10))) return null;
    const heavy = pct >= 40;
    return {
      id: 'finde', grupo: 'semana', score: clamp(heavy ? pct : 70 - pct * 2, 80), tono: heavy ? 'fuchsia' : 'teal', icono: 'moon',
      eyebrow: heavy ? 'Modo finde' : 'Finde tranquilo', titulo: `${Math.round(pct)} % en fin de semana`,
      visual: { tipo: 'anillo', pct, etiqueta: 'sáb + dom' },
      detalle: heavy ? 'Sábados y domingos concentran casi la mitad de tu gasto.' : 'Tus fines de semana apenas tocan la cartera.',
    };
  },
  ctx => {
    if (ctx.scope !== 'mes' || ctx.habitRows.length < 6) return null;
    const total = sumCents(ctx.habitRows);
    const days = Math.round((+ctx.end - +ctx.start) / 86_400_000);
    const middle = new Date(ctx.start.getFullYear(), ctx.start.getMonth(), ctx.start.getDate() + Math.floor(days / 2));
    const first = sumCents(ctx.habitRows.filter(row => row.fecha < middle));
    const pct = total ? first / total * 100 : 50;
    if (Math.abs(pct - 50) < 13) return null;
    const early = pct > 50;
    return {
      id: 'quincena', grupo: 'quincena', tono: early ? 'rose' : 'teal', icono: 'clock', score: clamp(Math.abs(pct - 50) * 2.4, 70),
      eyebrow: early ? 'Arrancas fuerte' : 'Sprint final', titulo: early ? 'Primera quincena' : 'Segunda quincena',
      visual: { tipo: 'versus', formato: 'dinero', antes: { label: '1.ª mitad', valor: first / 100 }, ahora: { label: '2.ª mitad', valor: (total - first) / 100 } },
      detalle: early
        ? `El ${Math.round(pct)} % de tu gasto del día a día cayó en la primera mitad del periodo.`
        : `Aguantaste al principio: el ${Math.round(100 - pct)} % llegó en la segunda mitad.`,
    };
  },
  ctx => {
    if (ctx.scope !== 'mes' || ctx.habitRows.length < 8) return null;
    const limit = new Date(ctx.start.getFullYear(), ctx.start.getMonth(), ctx.start.getDate() + 5);
    const total = sumCents(ctx.habitRows);
    const pct = total ? sumCents(ctx.habitRows.filter(row => row.fecha < limit)) / total * 100 : 0;
    return pct >= 35 && {
      id: 'arranque', grupo: 'quincena', tono: 'rose', icono: 'zap', score: clamp(pct * 1.3, 72),
      eyebrow: 'Salida en tromba', titulo: `${Math.round(pct)} % en 5 días`,
      visual: { tipo: 'anillo', pct, etiqueta: 'primeros 5 días' },
      detalle: 'Los cinco primeros días del periodo se llevaron una buena parte del pastel.',
    };
  },

  // ── How you spent ───────────────────────────────────────────────────────
  ctx => ({
    id: 'compra-mayor', grupo: 'compra-mayor', especial: true,
    score: clamp(20 + (ctx.gastos > 0 ? ctx.largest.cents / (ctx.gastos * 100) * 150 : 0), 90),
  }),
  ctx => {
    const smallest = [...ctx.habitRows].sort((a, b) => a.cents - b.cents || +a.fecha - +b.fecha)[0];
    return smallest && ctx.habitRows.length >= 8 && smallest.cents <= 300 && {
      id: 'compra-menor', grupo: 'compra-mayor', tono: 'teal', icono: 'tag', score: clamp(40 - smallest.cents / 10, 40),
      eyebrow: 'La más pequeñita', titulo: smallest.movement.concepto,
      visual: { tipo: 'cifra', valor: smallest.cents / 100, formato: 'dinero' },
      detalle: `El ${smallest.fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}. Hasta lo más pequeño cuenta.`,
    };
  },
  ctx => {
    const counts = new Map<number, { n: number; concepto: string }>();
    for (const { movement, cents } of ctx.habitRows) {
      const entry = counts.get(cents) ?? { n: 0, concepto: movement.concepto };
      entry.n++;
      counts.set(cents, entry);
    }
    const [cents, best] = [...counts].sort((a, b) => b[1].n - a[1].n || a[0] - b[0])[0] ?? [];
    return best && best.n >= 4 && {
      id: 'importe-repetido', tono: 'indigo', icono: 'repeat', score: clamp(25 + best.n * 4, 65),
      eyebrow: 'Déjà vu', titulo: `${fmt(cents / 100)}, ${best.n} veces`,
      visual: { tipo: 'cifra', valor: best.n, formato: 'numero', sufijo: `pagos de ${fmt(cents / 100)}` },
      detalle: `Pagaste exactamente lo mismo una y otra vez, por ejemplo en ${best.concepto}.`,
    };
  },
  ctx => ctx.pequenas.count >= 5 && {
    id: 'pequenas', grupo: 'pequenas', score: clamp(25 + ctx.pequenas.count * 1.5, 80), tono: 'amber', icono: 'coffee',
    eyebrow: 'Gota a gota', titulo: `${ctx.pequenas.count} compras pequeñas`,
    visual: { tipo: 'cifra', valor: ctx.pequenas.total, formato: 'dinero', sufijo: 'en total' },
    detalle: `Todas de menos de 5 €, pero juntas suman ${fmt(ctx.pequenas.total)}.`,
  },
  ctx => {
    const cafes = Math.floor(ctx.pequenas.total / 1.5);
    return ctx.pequenas.count >= 5 && cafes >= 10 && {
      id: 'cafes', grupo: 'pequenas', score: 30, tono: 'amber', icono: 'coffee',
      eyebrow: 'Puesto en perspectiva', titulo: `${cafes} cafés`,
      visual: { tipo: 'iconos', cantidad: cafes, icono: 'coffee' },
      detalle: 'Es lo que pagarías con tus compras pequeñas, a 1,50 € el café.',
    };
  },
  ctx => {
    if (ctx.expenses.length < 8) return null;
    const avg = ctx.gastos / ctx.expenses.length;
    const prevAvg = ctx.previousExpenses.length ? sumCents(ctx.previousExpenses) / 100 / ctx.previousExpenses.length : 0;
    const change = prevAvg > 0 ? (avg - prevAvg) / prevAvg * 100 : 0;
    return {
      id: 'ticket-medio', score: clamp(12 + Math.min(40, Math.abs(change) / 2), 55), tono: 'indigo', icono: 'receipt',
      eyebrow: 'Ticket medio', titulo: 'Lo que cuesta cada compra',
      visual: prevAvg > 0 && Math.abs(change) >= 10
        ? { tipo: 'versus', formato: 'dinero', antes: { label: ctx.previousLabel, valor: prevAvg }, ahora: { label: ctx.label, valor: avg } }
        : { tipo: 'cifra', valor: avg, formato: 'dinero', sufijo: 'por compra' },
      detalle: prevAvg > 0 && Math.abs(change) >= 10
        ? `Un ${Math.round(Math.abs(change))} % ${change < 0 ? 'menos' : 'más'} por compra que en ${ctx.previousLabel}.`
        : `Es lo que gastaste de media en cada una de tus ${ctx.expenses.length} compras.`,
    };
  },
  ctx => {
    const before = ctx.previousExpenses.length;
    const now = ctx.expenses.length;
    if (before < 5) return null;
    const change = (now - before) / before * 100;
    if (Math.abs(change) < 20) return null;
    return {
      id: 'num-compras', tono: change < 0 ? 'emerald' : 'rose', icono: change < 0 ? 'trend-down' : 'trend-up',
      score: clamp(20 + Math.abs(change) / 2, 60),
      eyebrow: change < 0 ? 'Menos tarjeta' : 'Tarjeta caliente',
      titulo: `${Math.abs(now - before)} compras ${change < 0 ? 'menos' : 'más'}`,
      visual: { tipo: 'versus', formato: 'numero', antes: { label: ctx.previousLabel, valor: before }, ahora: { label: ctx.label, valor: now } },
      detalle: change < 0 ? `Pasaste la tarjeta bastante menos que en ${ctx.previousLabel}.` : `Pasaste la tarjeta bastante más que en ${ctx.previousLabel}.`,
    };
  },
  ctx => {
    if (ctx.elapsedDays < 7) return null;
    const perDay = ctx.gastos / ctx.elapsedDays;
    return {
      id: 'media-diaria', tono: 'sky', icono: 'clock', score: pick(`${ctx.seedKey}:media`, [22, 26, 30]),
      eyebrow: 'Al día', titulo: pick(`${ctx.seedKey}:media-t`, ['Tu ritmo diario', 'Lo que cuesta un día tuyo', 'Día a día']),
      visual: { tipo: 'cifra', valor: perDay, formato: 'dinero', sufijo: 'al día' },
      detalle: pick(`${ctx.seedKey}:media-txt`, [
        'Contando todo: alquiler, súper, caprichos y lo que se escapa.',
        `Si lo repartimos entre los ${ctx.elapsedDays} días, sale a esto.`,
      ]),
    };
  },
  ctx => {
    if (ctx.suscripciones <= 0 || ctx.gastos <= 0) return null;
    const pct = ctx.suscripciones / ctx.gastos * 100;
    return {
      id: 'suscripciones', score: clamp(15 + pct * 2, 70), tono: 'rose', icono: 'repeat',
      eyebrow: 'En piloto automático', titulo: fmt(ctx.suscripciones),
      visual: { tipo: 'anillo', pct, etiqueta: 'suscripciones' },
      detalle: `Se fueron en suscripciones: el ${Math.round(pct)} % de tu gasto ${unit(ctx)}.`,
    };
  },

  // ── Days without spending ───────────────────────────────────────────────
  ctx => ctx.rachaSinGastos.dias >= 2 && {
    id: 'racha', especial: true, grupo: 'sin-gasto', score: clamp(ctx.rachaSinGastos.dias * 8, 85),
  },
  ctx => {
    if (ctx.scope !== 'mes' || ctx.elapsedDays <= 0) return null;
    const free = calendar(ctx).filter(level => level === 0).length;
    return free >= 4 && {
      id: 'dias-sin-gastar', grupo: 'sin-gasto', score: clamp(free / ctx.elapsedDays * 120, 75), tono: 'teal', icono: 'sparkles',
      eyebrow: 'Días en cero', titulo: `${free} días`,
      visual: { tipo: 'calendario', inicio: ctx.start, dias: calendar(ctx) },
      detalle: 'Sin un solo gasto. Tu cartera también descansa.',
    };
  },
  ctx => {
    let best = 0;
    let run = 0;
    let bestEnd = 0;
    const days = calendar(ctx);
    days.forEach((level, i) => {
      run = level > 0 ? run + 1 : 0;
      if (run > best) { best = run; bestEnd = i; }
    });
    return best >= 5 && {
      id: 'racha-gasto', grupo: 'racha-gasto', tono: 'rose', icono: 'flame', score: clamp(best * 3.5, 60),
      eyebrow: 'Racha en llamas', titulo: 'Sin soltar la tarjeta',
      visual: ctx.scope === 'mes' ? { tipo: 'calendario', inicio: ctx.start, dias: days, marcados: [bestEnd - best + 1, bestEnd] } : { tipo: 'cifra', valor: best, formato: 'numero', sufijo: 'días' },
      detalle: `${best} días seguidos con algún gasto. La próxima, a por la racha contraria.`,
    };
  },
  ctx => {
    if (ctx.elapsedDays < 14) return null;
    const active = calendar(ctx).filter(level => level > 0).length;
    const pct = active / ctx.elapsedDays * 100;
    return {
      id: 'dias-con-gasto', grupo: 'racha-gasto', tono: 'violet', icono: 'calendar', score: clamp(Math.abs(pct - 55) * 1.2, 50),
      eyebrow: 'Días de tarjeta', titulo: `${active} de ${ctx.elapsedDays} días`,
      visual: { tipo: 'anillo', pct, etiqueta: 'con algún gasto' },
      detalle: pct >= 70 ? 'Casi no hubo día sin pasar por caja.' : 'Más días libres que de compras. Nada mal.',
    };
  },
  ctx => {
    const first = [...ctx.expenses].sort((a, b) => +a.fecha - +b.fecha)[0];
    return first && first.movement.concepto !== ctx.largest.movement.concepto && {
      id: 'primer-gasto', grupo: 'primer', score: 14, tono: 'indigo', icono: 'tag',
      eyebrow: ctx.scope === 'mes' ? 'Así empezó el mes' : 'Así empezó el año', titulo: first.movement.concepto,
      visual: { tipo: 'cifra', valor: first.cents / 100, formato: 'dinero' },
      detalle: `Tu primer gasto fue el ${first.fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.`,
    };
  },

  // ── Against your own history ───────────────────────────────────────────
  ctx => {
    const hist = ctx.historia.filter(h => h.gastos > 0);
    if (hist.length < 2) return null;
    const values = [...hist.map(h => h.gastos), ctx.gastos];
    const labels = [...hist.map(h => h.corto), shortLabel(ctx)];
    const max = Math.max(...hist.map(h => h.gastos));
    const min = Math.min(...hist.map(h => h.gastos));
    const n = hist.length + 1;
    const what = ctx.scope === 'mes' ? 'meses' : 'años';
    if (ctx.gastos < min) {
      return {
        id: 'record-bajo', grupo: 'historia', tono: 'emerald', icono: 'trophy', score: clamp(60 + n * 3, 92),
        eyebrow: 'Récord personal', titulo: ctx.scope === 'mes' ? `Tu mes más contenido` : 'Tu año más contenido',
        visual: { tipo: 'barras', valores: values, etiquetas: labels, destacado: values.length - 1, formato: 'dinero' },
        detalle: `Gastaste menos que en cualquiera de tus últimos ${n} ${what}.`,
      };
    }
    if (ctx.gastos > max) {
      return {
        id: 'record-alto', grupo: 'historia', tono: 'rose', icono: 'flame', score: clamp(45 + n * 2, 75),
        eyebrow: 'Marca histórica (de las malas)', titulo: ctx.scope === 'mes' ? 'Tu mes más intenso' : 'Tu año más intenso',
        visual: { tipo: 'barras', valores: values, etiquetas: labels, destacado: values.length - 1, formato: 'dinero' },
        detalle: `Ninguno de tus últimos ${n} ${what} llegó tan alto.`,
      };
    }
    const avg = hist.reduce((a, h) => a + h.gastos, 0) / hist.length;
    const delta = (ctx.gastos - avg) / avg * 100;
    return Math.abs(delta) >= 8 && {
      id: 'vs-media', grupo: 'historia', tono: delta < 0 ? 'emerald' : 'amber', icono: 'chart',
      score: clamp(25 + Math.abs(delta), 70),
      eyebrow: 'Frente a tu media', titulo: `${Math.round(Math.abs(delta))} % ${delta < 0 ? 'por debajo' : 'por encima'}`,
      visual: { tipo: 'barras', valores: values, etiquetas: labels, destacado: values.length - 1, formato: 'dinero' },
      detalle: `Tu media de los ${hist.length} ${what} anteriores es ${fmt(avg)}.`,
    };
  },

  // ── Money in and saved ─────────────────────────────────────────────────
  ctx => ctx.ingresos > 0 && {
    id: 'ahorro', grupo: 'ahorro', especial: true,
    score: ctx.tasaAhorro === null ? 30 : clamp(ctx.tasaAhorro > 0 ? 40 + ctx.tasaAhorro : 35, 85),
  },
  ctx => {
    if (ctx.tasaAhorro === null || ctx.tasaAhorro <= 0) return null;
    const hist = ctx.historia.filter(h => h.ingresos > 0);
    if (hist.length < 2) return null;
    const rates = hist.map(h => (h.ingresos - h.gastos) / h.ingresos * 100);
    if (ctx.tasaAhorro <= Math.max(...rates)) return null;
    return {
      id: 'ahorro-record', grupo: 'ahorro', tono: 'emerald', icono: 'trophy', score: clamp(70 + hist.length * 2, 92),
      eyebrow: 'Nuevo récord de ahorro', titulo: `${Math.round(ctx.tasaAhorro)} % ahorrado`,
      visual: { tipo: 'barras', valores: [...rates.map(r => Math.max(0, r)), ctx.tasaAhorro], etiquetas: [...hist.map(h => h.corto), shortLabel(ctx)], destacado: hist.length, formato: 'pct' },
      detalle: `Tu mejor tasa de ahorro de los últimos ${hist.length + 1} ${ctx.scope === 'mes' ? 'meses' : 'años'}.`,
    };
  },
  ctx => {
    const extra = ctx.incomes.filter(row => row.movement.categoria !== 'nomina' && !/n[oó]mina/i.test(row.movement.concepto));
    const total = sumCents(extra) / 100;
    if (!extra.length || total < 50) return null;
    const biggest = [...extra].sort((a, b) => b.cents - a.cents)[0];
    return {
      id: 'ingresos-extra', tono: 'emerald', icono: 'wallet', score: clamp(25 + total / 20, 65),
      eyebrow: 'Dinero extra', titulo: 'Más allá de la nómina',
      visual: { tipo: 'cifra', valor: total, formato: 'dinero', sufijo: plural(extra.length, 'ingreso', 'ingresos') },
      detalle: `El más gordo: ${biggest.movement.concepto} (${fmt(biggest.cents / 100)}).`,
    };
  },

  // ── Annual only ────────────────────────────────────────────────────────
  ctx => {
    if (ctx.scope !== 'anio') return null;
    const elapsed = ctx.monthly.map((total, mes) => ({ mes, total })).filter(({ mes }) => new Date(ctx.start.getFullYear(), mes, 1) < ctx.end);
    const active = elapsed.filter(m => m.total > 0);
    if (active.length < 3) return null;
    const avg = active.reduce((a, m) => a + m.total, 0) / active.length;
    const below = active.filter(m => m.total < avg * 0.95).length;
    return {
      id: 'meses-bajo-media', tono: 'teal', icono: 'target', score: clamp(20 + below * 4, 60),
      eyebrow: 'Constancia', titulo: `${below} de ${active.length} meses`,
      visual: { tipo: 'barras', valores: active.map(m => m.total / 100), etiquetas: active.map(m => MONTH_SHORT[m.mes]), destacado: -1, formato: 'dinero' },
      detalle: `Por debajo de tu media mensual de ${fmt(avg / 100)}.`,
    };
  },
];

const unit = (ctx: InsightContext) => ctx.scope === 'mes' ? 'este mes' : 'este año';
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const shortLabel = (ctx: InsightContext) => ctx.scope === 'mes' ? ctx.label.slice(0, 3) : String(ctx.start.getFullYear());

/** Spending level (0 none … 3 heavy) for each elapsed day of the period. */
function calendar(ctx: InsightContext): number[] {
  const levels: number[] = [];
  const values = [...ctx.daily.values()].filter(v => v > 0).sort((a, b) => a - b);
  const q = (p: number) => values[Math.floor((values.length - 1) * p)] ?? 0;
  const [q1, q2] = [q(0.4), q(0.8)];
  for (let i = 0; i < ctx.elapsedDays; i++) {
    const key = +new Date(ctx.start.getFullYear(), ctx.start.getMonth(), ctx.start.getDate() + i);
    if (!ctx.spendDays.has(key)) { levels.push(0); continue; }
    const v = ctx.daily.get(key) ?? 0;
    levels.push(v <= q1 ? 1 : v <= q2 ? 2 : 3);
  }
  return levels;
}

function peakScore(ctx: InsightContext): number {
  const isMonth = ctx.scope === 'mes';
  const habitTotal = ctx.weekdays.reduce((a, b) => a + b, 0);
  const total = ctx.gastos * 100;
  const buckets = isMonth ? Math.max(1, ctx.elapsedDays) : Math.max(1, ctx.monthly.filter(v => v > 0).length);
  const peak = isMonth ? Math.max(0, ...ctx.daily.values()) : Math.max(...ctx.monthly);
  const ratio = isMonth ? (habitTotal > 0 ? peak / (habitTotal / buckets) : 0) : (total > 0 ? peak / (total / buckets) : 0);
  return clamp(10 + (ratio - 1) * (isMonth ? 4 : 15), 80);
}

// Display order: from where the money went, to where and when, to how, to the bottom line.
export const STORY_ORDER = [
  'categorias', 'categoria-reina', 'categoria-sube', 'categoria-baja', 'categoria-nueva', 'vivienda', 'equivalencia',
  'comercios', 'podio', 'fidelidad', 'comercio-ausente', 'comercios-nuevos', 'comercio-caro', 'doble-visita',
  'ritmo', 'semana', 'dia-semana', 'finde', 'quincena', 'arranque',
  'compra-mayor', 'compra-menor', 'importe-repetido', 'pequenas', 'cafes', 'ticket-medio', 'num-compras', 'media-diaria', 'suscripciones',
  'racha', 'dias-sin-gastar', 'racha-gasto', 'dias-con-gasto', 'primer-gasto',
  'record-bajo', 'record-alto', 'vs-media', 'meses-bajo-media',
  'ingresos-extra', 'ahorro-record', 'ahorro',
];
const order = (id: string) => {
  const index = STORY_ORDER.indexOf(id);
  return index < 0 ? STORY_ORDER.length : index;
};

/** How far a seeded nudge can move a score, so near-ties resolve differently each period. */
const JITTER = 14;

/**
 * Runs every template. Scores get a small deterministic nudge per period, so a
 * month where two facts are equally striking does not always pick the same one.
 */
export function buildInventory(ctx: InsightContext): WrappedHighlight[] {
  const cards = TEMPLATES.flatMap(template => {
    const result = template(ctx);
    return result ? (Array.isArray(result) ? result : [result]) : [];
  }).map(card => ({ ...card, score: clamp(card.score + (seeded(`${ctx.seedKey}:${card.id}`) - 0.5) * JITTER) }));
  return cards.sort((a, b) => b.score - a.score || order(a.id) - order(b.id));
}

const ROTATION_FACTOR = 0.4;

/**
 * Picks the `max` most striking cards. Cards that led the previous Wrapped
 * lose 60 % of their score (their whole group loses a little too), so
 * consecutive months rarely look the same. The result follows the story
 * order, not the score order.
 */
export function selectHighlights(inventario: readonly WrappedHighlight[], max: number, previous: readonly string[] = []): string[] {
  const shown = new Set(previous);
  const shownGroups = new Set(inventario.filter(card => card.grupo && shown.has(card.id)).map(card => card.grupo));
  const groups = new Set<string>();
  const picked: string[] = [];
  const ranked = [...inventario]
    .map(card => ({
      card,
      score: shown.has(card.id) ? card.score * ROTATION_FACTOR : card.grupo && shownGroups.has(card.grupo) ? card.score * 0.85 : card.score,
    }))
    .sort((a, b) => b.score - a.score || order(a.card.id) - order(b.card.id));
  for (const { card } of ranked) {
    if (picked.length >= max) break;
    if (card.grupo && groups.has(card.grupo)) continue;
    if (card.grupo) groups.add(card.grupo);
    picked.push(card.id);
  }
  return picked.sort((a, b) => order(a) - order(b));
}

export interface WrappedPersonality { titulo: string; descripcion: string }

const CATEGORY_PERSONALITIES: Record<string, [string, string]> = {
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

/**
 * Hormiguita (savings rate of 30 % or more) usually wins. With enough
 * purchases, a behaviour (loyal, explorer, weekend…) can beat the top
 * category; the previous period's title weighs less so it does not repeat
 * month after month.
 */
export function choosePersonality(ctx: InsightContext, previousTitle?: string): WrappedPersonality {
  const top = ctx.categories.find(c => c.categoria !== 'vivienda') ?? ctx.categories[0];
  const [titulo, descripcion] = CATEGORY_PERSONALITIES[top?.categoria] ?? ['Equilibrista', 'Sabes encontrar tu propio equilibrio entre tantos planes.'];
  const candidates: { titulo: string; descripcion: string; fuerza: number }[] = [{ titulo, descripcion, fuerza: 50 }];
  if (ctx.tasaAhorro !== null && ctx.tasaAhorro >= 30) {
    candidates.push({ titulo: 'Hormiguita', descripcion: 'Paso a paso, tu colchón sigue creciendo.', fuerza: 90 });
  }
  if (ctx.expenses.length >= 15) {
    const visits = ctx.merchantList.reduce((a, m) => a + m.visitas, 0);
    const favShare = ctx.comercioFavorito && visits ? ctx.comercioFavorito.visitas / visits * 100 : 0;
    if (favShare >= 30) candidates.push({ titulo: 'Fiel a los tuyos', descripcion: `${ctx.comercioFavorito!.nombre} ya te reconoce al entrar.`, fuerza: 40 + favShare / 2 });
    const nuevos = ctx.previousMerchants.size ? ctx.merchantList.filter(m => !ctx.previousMerchants.has(m.key)).length : 0;
    if (nuevos >= 6) candidates.push({ titulo: 'Explorador urbano', descripcion: 'Nuevos sitios, nuevas historias. Te va probar.', fuerza: 45 + nuevos * 2 });
    const habit = ctx.weekdays.reduce((a, b) => a + b, 0);
    const weekend = habit ? (ctx.weekdays[5] + ctx.weekdays[6]) / habit * 100 : 0;
    if (weekend >= 45) candidates.push({ titulo: 'Rey del finde', descripcion: 'De lunes a viernes, modo ahorro. El sábado, otra historia.', fuerza: 30 + weekend / 2 });
    if (ctx.pequenas.count >= 12) candidates.push({ titulo: 'Gota a gota', descripcion: 'Lo tuyo son los pequeños placeres. Muchos.', fuerza: 40 + ctx.pequenas.count });
    const fixed = ctx.gastos ? (ctx.gastos * 100 - sumCents(ctx.habitRows)) / (ctx.gastos * 100) * 100 : 0;
    if (fixed >= 60) candidates.push({ titulo: 'Piloto automático', descripcion: 'Tus gastos fijos mandan; el resto lo tienes a raya.', fuerza: fixed - 5 });
  }
  const best = candidates
    .map(c => ({ ...c, fuerza: c.titulo === previousTitle ? c.fuerza * 0.6 : c.fuerza }))
    .sort((a, b) => b.fuerza - a.fuerza)[0];
  return { titulo: best.titulo, descripcion: best.descripcion };
}
