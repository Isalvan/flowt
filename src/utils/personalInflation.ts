import type { Movimiento } from '../types';
import { roundMoney } from './incomeSplit';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { parseMovimientoDate } from './periodStats';
// The same merchant rule Wrapped uses, so a place has the same name in both.
import { merchantKey } from './serviceNames';

/** The recent stretch: the last 90 days. */
export const RECENT_DAYS = 90;
/** A year ago, from two months before to one month after, as far as the loaded movements reach. */
const BASE_BEFORE_DAYS = 60;
const BASE_AFTER_DAYS = 30;
/** Shorter than this, the year-ago stretch says too little. */
const MIN_BASE_DAYS = 30;
/** Visits needed in each stretch for a price per visit to mean something. */
export const MIN_VISITS = 3;
const MIN_MERCHANTS = 2;
const DAY = 86_400_000;

export interface MerchantPrice {
  key: string;
  nombre: string;
  /** Typical (median) amount per visit a year ago. */
  antes: number;
  /** Typical (median) amount per visit in the last 90 days. */
  ahora: number;
  visitasAntes: number;
  visitasAhora: number;
  /** Relative change of the price per visit: 0.1 is 10 % more. */
  cambio: number;
  /** What the recent visits cost more (or less) than at last year's price, in euros. */
  extra: number;
}

export interface PersonalInflation {
  /** Your recent visits at today's prices against the same visits at last year's prices: 0.05 is 5 % more. */
  indice: number;
  /** The extra, spread over a month of 30 days. */
  extraMensual: number;
  /** Merchants with enough visits in both stretches, biggest effect first. */
  comercios: MerchantPrice[];
  /** The year-ago stretch, inclusive dates. */
  antesDesde: Date;
  antesHasta: Date;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

interface Visits { nombre: string; latest: number; antes: number[]; ahora: number[] }

/**
 * Your personal price index: what you pay per visit now at the places you keep
 * going to, against what you paid there a year ago. It only reads movements;
 * a place counts when it has at least three visits in each stretch.
 */
export function personalInflation(movimientos: readonly Movimiento[], now = new Date()): PersonalInflation | null {
  const today = startOfDay(now);
  const recentStart = addDays(today, -(RECENT_DAYS - 1));
  const yearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const firstMovement = Math.min(...movimientos.flatMap(movement => {
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    return fecha ? [startOfDay(fecha).getTime()] : [];
  }));
  if (!Number.isFinite(firstMovement)) return null;
  // Older movements may not be loaded: the year-ago stretch starts no earlier than the first one.
  const antesDesde = new Date(Math.max(addDays(yearAgo, -BASE_BEFORE_DAYS).getTime(), firstMovement));
  const baseEndExclusive = addDays(yearAgo, BASE_AFTER_DAYS + 1);
  if (Math.round((baseEndExclusive.getTime() - antesDesde.getTime()) / DAY) < MIN_BASE_DAYS) return null;

  const visits = new Map<string, Visits>();
  for (const movement of movimientos) {
    if (movement.tipo !== 'gasto' || !cuentaEnEstadisticas(movement)) continue;
    // Rent, subscriptions and payroll are bills, not places you choose to go.
    if (movement.suscripcion_id || movement.categoria === 'vivienda' || movement.categoria === 'nomina') continue;
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    if (!fecha || fecha > now) continue;
    const inRecent = fecha >= recentStart;
    const inBase = fecha >= antesDesde && fecha < baseEndExclusive;
    if (!inRecent && !inBase) continue;
    const amount = importeEnEstadisticas(movement);
    if (amount <= 0) continue;
    const key = merchantKey(movement.concepto);
    if (key.length < 3 || !/[a-z]{3}/.test(key)) continue;
    const nombre = movement.concepto.trim();
    const entry = visits.get(key) ?? { nombre, latest: -Infinity, antes: [], ahora: [] };
    (inRecent ? entry.ahora : entry.antes).push(amount);
    if (fecha.getTime() > entry.latest) { entry.nombre = nombre; entry.latest = fecha.getTime(); }
    visits.set(key, entry);
  }

  const comercios: MerchantPrice[] = [];
  for (const [key, entry] of visits) {
    if (entry.antes.length < MIN_VISITS || entry.ahora.length < MIN_VISITS) continue;
    const antes = roundMoney(median(entry.antes));
    const ahora = roundMoney(median(entry.ahora));
    if (antes <= 0) continue;
    comercios.push({
      key, nombre: entry.nombre, antes, ahora,
      visitasAntes: entry.antes.length, visitasAhora: entry.ahora.length,
      cambio: ahora / antes - 1,
      extra: roundMoney((ahora - antes) * entry.ahora.length),
    });
  }
  if (comercios.length < MIN_MERCHANTS) return null;
  comercios.sort((a, b) => Math.abs(b.extra) - Math.abs(a.extra) || b.visitasAhora - a.visitasAhora || a.key.localeCompare(b.key));

  // Today's basket of visits, priced now and a year ago.
  const atNow = comercios.reduce((sum, merchant) => sum + merchant.ahora * merchant.visitasAhora, 0);
  const atBefore = comercios.reduce((sum, merchant) => sum + merchant.antes * merchant.visitasAhora, 0);
  const extra = comercios.reduce((sum, merchant) => sum + merchant.extra, 0);
  return {
    indice: atNow / atBefore - 1,
    extraMensual: roundMoney(extra * 30 / RECENT_DAYS),
    comercios,
    antesDesde,
    antesHasta: addDays(baseEndExclusive, -1),
  };
}

/** A change as a signed percentage with one decimal, as Spanish readers write it. */
export const percentChange = (fraction: number): string => {
  const value = Math.round(fraction * 1000) / 10;
  if (value === 0) return '0 %';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
};
