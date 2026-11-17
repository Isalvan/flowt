import type { Movimiento, TicketPersona, TicketScanResult } from '../types';
import { parseMovimientoDate } from './periodStats';

export const normalizeTicketText = (text: string): string => text.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const cents = (amount: number) => Math.round(amount * 100);

/** Amounts are returned in euros; all allocation and rounding is done in cents. */
export function splitTicket(
  ticket: Pick<TicketScanResult, 'total' | 'lineas'>,
  personas: Pick<TicketPersona, 'nombre' | 'yo'>[],
  asignaciones: readonly (readonly number[])[] = [],
): TicketPersona[] {
  if (!personas.length || personas.length > 12) throw new Error('El reparto necesita entre 1 y 12 personas.');
  if (!Number.isFinite(ticket.total) || ticket.total <= 0 || ticket.total > 10000 ||
    ticket.lineas.some(l => !Number.isFinite(l.importe))) throw new Error('El ticket contiene importes no válidos.');
  // LCM(1..12) preserves fractional cents until the final rounding. Rounding each
  // line separately would give every odd cent to the first person on the receipt.
  const unit = 27720n;
  const subtotals = personas.map(() => 0n);
  ticket.lineas.forEach((line, index) => {
    const selected = [...new Set(asignaciones[index] ?? [])].filter(i => Number.isInteger(i) && i >= 0 && i < personas.length).sort((a, b) => a - b);
    const indices = selected.length ? selected : personas.map((_, i) => i);
    const share = BigInt(cents(line.importe)) * unit / BigInt(indices.length);
    indices.forEach(person => { subtotals[person] += share; });
  });
  const total = BigInt(cents(ticket.total));
  const difference = total * unit - subtotals.reduce((a, b) => a + b, 0n);
  // Negative personal subtotals do not attract additional global discounts.
  let weights = subtotals.map(s => s > 0n ? s : 0n);
  if (weights.every(w => w === 0n)) weights = personas.map(() => 1n);
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  const denominator = unit * weightSum;
  const numerators = subtotals.map((s, i) => s * weightSum + difference * weights[i]);
  const amounts = numerators.map(n => n / denominator - (n % denominator < 0n ? 1n : 0n));
  const order = numerators.map((n, i) => ({ i, remainder: n - amounts[i] * denominator }))
    .sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  const rest = Number(total - amounts.reduce((a, b) => a + b, 0n));
  for (let i = 0; i < rest; i++) amounts[order[i].i]++;
  return personas.map((person, i) => ({ ...person, importe: Number(amounts[i]) / 100 }));
}

/** Calendar days avoid DST offsets and time-of-day differences at the boundary. */
export function ticketDay(value: Movimiento['fecha_operacion']): number | null {
  const date = parseMovimientoDate(value);
  if (!date) return null;
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return Date.parse(key) / 86_400_000;
}

export function findTicketMatch(movimientos: Movimiento[], ticket: Pick<TicketScanResult, 'comercio' | 'fecha' | 'total'>): Movimiento | null {
  if (!ticket.fecha) return null;
  const day = ticketDay(ticket.fecha);
  if (day === null) return null;
  const merchant = normalizeTicketText(ticket.comercio);
  return movimientos.filter(m => m.tipo === 'gasto' && !m.es_interno && !m.transfer_id && !m.ticket &&
    Math.abs(cents(m.importe) - cents(ticket.total)) <= 1 && ticketDay(m.fecha_operacion) !== null &&
    Math.abs(ticketDay(m.fecha_operacion)! - day) <= 3)
    .map(m => ({ m, merchant: merchant.length > 0 && normalizeTicketText(m.concepto).includes(merchant), distance: Math.abs(ticketDay(m.fecha_operacion)! - day) }))
    .sort((a, b) => Number(b.merchant) - Number(a.merchant) || a.distance - b.distance || a.m.id.localeCompare(b.m.id))[0]?.m ?? null;
}

export function ticketMoney(amount: number, currency = 'EUR'): string {
  return `${amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'EUR' ? '€' : currency}`;
}

export function ticketSummaryText(ticket: Pick<TicketScanResult, 'comercio' | 'fecha' | 'total' | 'moneda'>, reparto: TicketPersona[]): string {
  const date = ticket.fecha ? ` (${ticket.fecha.slice(8, 10)}/${ticket.fecha.slice(5, 7)})` : '';
  return `Ticket ${ticket.comercio}${date}: ${reparto.map(p => `${p.nombre} ${ticketMoney(p.importe, ticket.moneda)}`).join(', ')}. Total ${ticketMoney(ticket.total, ticket.moneda)}`;
}
