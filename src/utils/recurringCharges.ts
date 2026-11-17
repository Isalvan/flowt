import type { Movimiento, Suscripcion } from '../types';
import { cuentaEnEstadisticas } from './movements';
import { isSubscriptionMovement, normalizeServiceName, resolveServiceKey } from './serviceNames';
import { isCancellationExpired, parseSubscriptionDate, toLocalDateKey } from './subscriptions';

export interface RecurringCandidate {
  key: string;
  nombre: string;
  importe: number;
  dia_pago: number;
  fecha_inicio: string;
  categoria: string;
  movimientoIds: string[];
  meses: number;
}

export interface PriceChange {
  suscripcionId: string;
  nombre: string;
  importeAnterior: number;
  importeNuevo: number;
  movimientoId: string;
  fecha: string;
  diferenciaMensual: number;
  diferenciaAnual: number;
}

// Remove bank references (including mixed alphanumeric tokens) before grouping.
const cleanConcept = (concept: string): string => concept
  .replace(/\b(?:ref(?:erencia)?|id|operaci[oó]n)\s*[:.#-]?\s*[\w-]*\d[\w-]*/gi, ' ')
  .replace(/\S*\d\S*/g, ' ')
  .replace(/[^\p{L}\s]/gu, ' ')
  .replace(/\s+/g, ' ').trim();

const eligibleExpense = (movement: Movimiento): boolean => movement.tipo === 'gasto'
  && cuentaEnEstadisticas(movement) && !movement.es_metalico
  && Number.isFinite(movement.importe) && movement.importe > 0;

const datedExpenses = (movimientos: Movimiento[]) => movimientos
  .filter(eligibleExpense)
  .flatMap(movement => {
    const date = parseSubscriptionDate(movement.fecha_operacion);
    return date ? [{ movement, date }] : [];
  })
  .sort((a, b) => a.date.getTime() - b.date.getTime() || a.movement.id.localeCompare(b.movement.id));

export function detectNewSubscriptions(
  movimientos: Movimiento[], suscripciones: Suscripcion[], today = new Date(),
): RecurringCandidate[] {
  const boundary = parseSubscriptionDate(today)!;
  const names = suscripciones.map(s => s.nombre);
  const groups = new Map<string, ReturnType<typeof datedExpenses>>();
  for (const entry of datedExpenses(movimientos)) {
    const { movement, date } = entry;
    if (date > boundary || movement.suscripcion_id
      || isSubscriptionMovement(movement.concepto, names)
      || isSubscriptionMovement(cleanConcept(movement.concepto), names)) continue;
    const key = resolveServiceKey(movement.concepto) ?? normalizeServiceName(cleanConcept(movement.concepto));
    if (key.length < 4) continue;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const candidates: RecurringCandidate[] = [];
  for (const [key, group] of groups) {
    const months = group.map(({ date }) => date.getFullYear() * 12 + date.getMonth());
    if (new Set(months).size !== months.length) continue;
    // Only the consecutive run ending in the latest charge proves current recurrence.
    let start = group.length - 1;
    while (start > 0 && months[start] - months[start - 1] === 1) start--;
    const run = group.slice(start);
    if (run.length < 3) continue;
    const latest = run[run.length - 1];
    const oldestAllowed = new Date(boundary);
    oldestAllowed.setDate(oldestAllowed.getDate() - 45);
    if (latest.date < oldestAllowed) continue;
    const amounts = run.map(({ movement }) => movement.importe).sort((a, b) => a - b);
    const middle = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2;
    if (amounts.some(amount => Math.abs(amount - median) > Math.max(1, median * 0.15))) continue;
    const categories = new Map<string, number>();
    for (const { movement } of run) {
      const category = movement.categoria || 'otros';
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
    candidates.push({
      key, nombre: cleanConcept(latest.movement.concepto), importe: latest.movement.importe,
      dia_pago: latest.date.getDate(), fecha_inicio: toLocalDateKey(latest.date),
      categoria: [...categories].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'otros',
      movimientoIds: run.map(({ movement }) => movement.id), meses: run.length,
    });
  }
  return candidates.sort((a, b) => b.importe * 12 - a.importe * 12);
}

export function detectPriceChanges(movimientos: Movimiento[], suscripciones: Suscripcion[]): PriceChange[] {
  const expenses = datedExpenses(movimientos).filter(({ date }) => date <= new Date());
  return suscripciones.flatMap(subscription => {
    if (!subscription.activa || isCancellationExpired(subscription) || !Number.isFinite(subscription.importe)) return [];
    const linked = expenses.filter(({ movement }) => movement.suscripcion_id === subscription.id);
    const charges = linked.length ? linked : expenses.filter(({ movement }) =>
      !movement.suscripcion_id && (
        isSubscriptionMovement(movement.concepto, [subscription.nombre])
        || isSubscriptionMovement(cleanConcept(movement.concepto), [subscription.nombre])
      ));
    const latest = charges[charges.length - 1];
    if (!latest) return [];
    const difference = Number((latest.movement.importe - subscription.importe).toFixed(2));
    if (difference <= Math.max(0.5, subscription.importe * 0.02)) return [];
    const cadence = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 }[subscription.frecuencia];
    return [{
      suscripcionId: subscription.id, nombre: subscription.nombre,
      importeAnterior: subscription.importe, importeNuevo: latest.movement.importe,
      movimientoId: latest.movement.id, fecha: toLocalDateKey(latest.date),
      diferenciaMensual: difference / cadence, diferenciaAnual: difference * 12 / cadence,
    }];
  });
}
