import type { Movimiento } from '../types';

export type HistoryFilter = 'all' | 'ingreso' | 'gasto';

const normalizeConcept = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function matchesHistoryMovement(
  movement: Movimiento,
  searchTerm: string,
  filterType: HistoryFilter,
): boolean {
  if (filterType !== 'all' && movement.tipo !== filterType) return false;
  const term = searchTerm.trim();
  return !term || normalizeConcept(movement.concepto).includes(normalizeConcept(term)) ||
    movement.importe.toString().includes(term.replace(',', '.'));
}
