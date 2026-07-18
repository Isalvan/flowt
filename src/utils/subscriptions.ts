import type { Suscripcion } from '../types';

const FREQUENCY_MONTHS: Record<Suscripcion['frecuencia'], number> = {
  mensual: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

const startOfDay = (value: Date): Date => {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
};

export const parseSubscriptionDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfDay(value);
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const converted = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(converted.getTime()) ? null : startOfDay(converted);
  }
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const parsed = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
  }
  return null;
};

export const toLocalDateKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const clampDayToMonth = (year: number, month: number, day: number): Date => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(Math.max(day, 1), lastDay));
};

export const getSubscriptionAnchorDate = (subscription: Suscripcion, fallback = new Date()): Date => {
  const explicit = parseSubscriptionDate(subscription.fecha_inicio);
  if (explicit) return explicit;

  const created = parseSubscriptionDate(subscription.created_at);
  if (created) {
    return clampDayToMonth(created.getFullYear(), created.getMonth(), subscription.dia_pago);
  }

  return clampDayToMonth(fallback.getFullYear(), fallback.getMonth(), subscription.dia_pago);
};

export const getSubscriptionChargeForMonth = (
  subscription: Suscripcion,
  year: number,
  month: number,
  fallback = new Date(),
): Date | null => {
  const anchor = getSubscriptionAnchorDate(subscription, fallback);
  const monthDistance = (year - anchor.getFullYear()) * 12 + month - anchor.getMonth();
  const cadence = FREQUENCY_MONTHS[subscription.frecuencia] ?? 1;
  if (monthDistance < 0 || monthDistance % cadence !== 0) return null;
  return clampDayToMonth(year, month, subscription.dia_pago || anchor.getDate());
};

export const getNextSubscriptionChargeDate = (
  subscription: Suscripcion,
  from = new Date(),
  includeToday = true,
): Date => {
  const boundary = startOfDay(from);
  for (let offset = 0; offset <= 120; offset += 1) {
    const month = new Date(boundary.getFullYear(), boundary.getMonth() + offset, 1);
    const charge = getSubscriptionChargeForMonth(
      subscription,
      month.getFullYear(),
      month.getMonth(),
      boundary,
    );
    if (charge && (includeToday ? charge >= boundary : charge > boundary)) return charge;
  }

  return clampDayToMonth(boundary.getFullYear() + 10, boundary.getMonth(), subscription.dia_pago);
};

export const getCancellationDate = (subscription: Suscripcion): Date | null => {
  const explicit = parseSubscriptionDate(subscription.cancel_at);
  if (explicit) return explicit;
  if (!subscription.cancelando) return null;
  const requestedAt = parseSubscriptionDate(subscription.updated_at) ?? new Date();
  return getNextSubscriptionChargeDate(subscription, requestedAt, true);
};

export const isCancellationExpired = (subscription: Suscripcion, today = new Date()): boolean => {
  const cancellationDate = getCancellationDate(subscription);
  return Boolean(cancellationDate && startOfDay(today) >= cancellationDate);
};

export const getEffectiveSubscriptionAmount = (subscription: Suscripcion): number => (
  subscription.mi_parte != null ? Number(subscription.mi_parte) : Number(subscription.importe)
);

export const getMonthlySubscriptionAmount = (subscription: Suscripcion): number => {
  const cadence = FREQUENCY_MONTHS[subscription.frecuencia] ?? 1;
  return getEffectiveSubscriptionAmount(subscription) / cadence;
};
