import catalog from '../../tracker-backend/prompts/banks.json';
import type { Movimiento } from '../types';
import type { Bank } from '../context/bankContext';
import { hasMovementTime, movementDate } from './movementSuggestions';

export const BANK_CATALOG = catalog;
export const bankNameKey = (name: string) => name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function bankDate(value: unknown): Date | null {
  if (!value) return null;
  const date = typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
    ? value.toDate() as Date : value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = (date: Date) => dayFormatter.format(date);
export const roundBankAmount = (amount: number) => Math.round((amount + Math.sign(amount) * Number.EPSILON) * 100) / 100;

/** The bank's movements that came after its balance was noted: the ones that move the estimate. */
export function movementsSinceAnchor(bank: Bank, movimientos: Movimiento[]): Movimiento[] {
  if (bank.anclaSaldo === undefined || !bank.anclaFecha) return [];
  const anchor = bank.anclaFecha;
  const name = bank.nombre.trim().replace(/\s+/g, ' ').toLowerCase();
  return movimientos.filter(m => {
    if (m.banco?.trim().replace(/\s+/g, ' ').toLowerCase() !== name || (m.es_metalico && m.tipo === 'ingreso')) return false;
    const date = movementDate(m);
    if (!date) return false;
    return hasMovementTime(m) ? date > anchor : day(date) > day(anchor) || (day(date) === day(anchor) && (bankDate(m.created_at)?.getTime() ?? 0) > anchor.getTime());
  });
}

export function estimateBankBalance(bank: Bank, movimientos: Movimiento[]): number | null {
  if (bank.anclaSaldo === undefined || !bank.anclaFecha) return null;
  return roundBankAmount(movementsSinceAnchor(bank, movimientos).reduce((total, m) => total + (m.tipo === 'ingreso' ? m.importe : -m.importe), bank.anclaSaldo));
}

const shortDay = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short' });
/** What the estimate rests on, e.g. "3 movimientos desde el 11 oct". */
export function estimateBasisLabel(bank: Bank, movimientos: Movimiento[]): string {
  const count = movementsSinceAnchor(bank, movimientos).length;
  const since = shortDay.format(bank.anclaFecha!).replace('.', '');
  return count === 0 ? `Sin cambios desde el ${since}` : `${count} ${count === 1 ? 'movimiento' : 'movimientos'} desde el ${since}`;
}

export function banksSummary(banks: Bank[], movimientos: Movimiento[], walletsTotal: number) {
  const balances = banks.map(bank => estimateBankBalance(bank, movimientos));
  const missing = balances.filter(balance => balance === null).length;
  const total = roundBankAmount(balances.reduce<number>((sum, balance) => sum + (balance ?? 0), 0));
  return { total, missing, difference: missing === 0 ? roundBankAmount(total - walletsTotal) : null };
}

export function anchorAge(date: Date, now = new Date()): number {
  return Math.max(0, Math.round((Date.parse(day(now)) - Date.parse(day(date))) / 86_400_000));
}
export function anchorDateLabel(date: Date): string {
  const days = anchorAge(date);
  return days === 0 ? 'Anotado hoy' : days === 1 ? 'Anotado ayer' : `Anotado hace ${days} días`;
}

export function bankInitials(nombre: string): string {
  const words = nombre.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

export function detectedBanks(movimientos: Pick<Movimiento, 'banco'>[]): string[] {
  const counts = new Map<string, { nombre: string; count: number }>();
  for (const movimiento of movimientos) {
    const nombre = movimiento.banco?.trim();
    if (!nombre || nombre.toLowerCase() === 'banco') continue;
    const key = nombre.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { nombre, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre, 'es')).map(b => b.nombre);
}
