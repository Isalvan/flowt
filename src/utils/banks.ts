import catalog from '../../tracker-backend/prompts/banks.json';
import type { Movimiento } from '../types';

export const BANK_CATALOG = catalog;
export const bankNameKey = (name: string) => name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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
