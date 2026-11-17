import { useMemo, useSyncExternalStore } from 'react';
import type { Movimiento, Suscripcion } from '../types';
import { detectNewSubscriptions, detectPriceChanges } from '../utils/recurringCharges';

const volatileDismissals = new Map<string, string>();
const eventName = 'flowt:recurring-dismissed-change';
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener);
  window.addEventListener(eventName, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(eventName, listener);
  };
};
const read = (key: string): string => {
  try { return volatileDismissals.get(key) ?? localStorage.getItem(key) ?? '[]'; }
  catch { return volatileDismissals.get(key) ?? '[]'; }
};
const parse = (raw: string): string[] => {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
};

export function useRecurringAlerts(movimientos: Movimiento[], suscripciones: Suscripcion[], userId: string) {
  const key = `flowt:recurring-dismissed:${userId}`;
  const snapshot = useSyncExternalStore(subscribe, () => read(key), () => '[]');
  const detected = useMemo(() => ({
    candidates: detectNewSubscriptions(movimientos, suscripciones),
    priceChanges: detectPriceChanges(movimientos, suscripciones),
  }), [movimientos, suscripciones]);
  const dismissed = parse(snapshot);
  const candidates = detected.candidates.filter(item => !dismissed.includes(`new:${item.key}`));
  const priceChanges = detected.priceChanges.filter(item => !dismissed.includes(`price:${item.suscripcionId}:${item.movimientoId}`));
  const dismiss = (id: string) => {
    const next = JSON.stringify([...new Set([...parse(read(key)), id])]);
    try {
      localStorage.setItem(key, next);
      volatileDismissals.delete(key);
    } catch { volatileDismissals.set(key, next); }
    window.dispatchEvent(new Event(eventName));
  };
  return { candidates, priceChanges, dismiss, count: candidates.length + priceChanges.length };
}
