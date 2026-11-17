import type { Movimiento } from '../types';
import { normalizeTicketText } from './ticketSplit';

export function ticketPersonNamed(concept: string, name: string): boolean {
  const normalized = normalizeTicketText(name);
  return normalized.length > 0 && ` ${normalizeTicketText(concept)} `.includes(` ${normalized} `);
}

/** One reimbursement can settle only one person, even when several shares match. */
export function paidTicketPeople(expense: Movimiento, movements: Movimiento[]): Set<number> {
  const people = expense.ticket?.personas ?? [];
  const incomeById = new Map(movements.filter(m => m.tipo === 'ingreso').map(m => [m.id, m]));
  const payments = new Map((expense.compensado_por_detalles ?? []).map(d => [d.ingreso_id, d.importe]));
  for (const id of expense.compensado_por ?? []) {
    if (!payments.has(id) && incomeById.has(id)) payments.set(id, incomeById.get(id)!.importe);
  }
  for (const income of incomeById.values()) {
    if (payments.has(income.id)) continue;
    const allocation = income.compensaciones_destinos?.find(d => d.gasto_id === expense.id);
    if (allocation) payments.set(income.id, allocation.importe);
    else if (income.compensa_movimiento_id === expense.id) payments.set(income.id, income.importe);
  }
  const candidates = [...payments].map(([id, amount]) => ({
    id, indices: people.flatMap((p, i) => !p.yo && Math.round(p.importe * 100) === Math.round(amount * 100) ? [i] : []),
  })).map(payment => ({ ...payment, named: payment.indices.filter(i => ticketPersonNamed(incomeById.get(payment.id)?.concepto ?? '', people[i].nombre)) }));
  const paid = new Set<number>();
  candidates.sort((a, b) => Number(b.named.length > 0) - Number(a.named.length > 0) || a.id.localeCompare(b.id));
  for (const payment of candidates) {
    const index = (payment.named.length ? payment.named : payment.indices).find(i => !paid.has(i));
    if (index !== undefined) paid.add(index);
  }
  return paid;
}
