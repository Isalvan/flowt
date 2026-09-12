import type { Movimiento, Suscripcion } from '../types';
import { parseMovimientoDate } from '../hooks/useFinanceData';
import { getEffectiveSubscriptionAmount, getSubscriptionChargeForMonth } from './subscriptions';

export interface ProjectionEstimates {
  monthlyIncome: number;
  dailyVariable: number;
  activeSubs: Suscripcion[];
  observedDays: number;
}

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const calculateProjectionEstimates = (movements: Movimiento[], subscriptions: Suscripcion[], now = new Date()): ProjectionEstimates | null => {
  const dated = movements.map(movement => ({ movement, date: parseMovimientoDate(movement.fecha_operacion) })).filter((entry): entry is { movement: Movimiento; date: Date } => Boolean(entry.date));
  if (dated.length < 2) return null;
  const minTime = Math.min(...dated.map(entry => entry.date.getTime()));
  const maxTime = Math.min(now.getTime(), Math.max(...dated.map(entry => entry.date.getTime())));
  const observedDays = Math.ceil((maxTime - minTime) / 86400000);
  if (observedDays < 7) return null;
  const income = dated.filter(entry => entry.movement.tipo === 'ingreso').reduce((sum, entry) => sum + entry.movement.importe, 0);
  if (income <= 0) return null;
  const activeSubs = subscriptions.filter(subscription => subscription.activa);
  const subscriptionNames = activeSubs.map(subscription => normalize(subscription.nombre)).filter(Boolean);
  const variableExpenses = dated.filter(entry => entry.movement.tipo === 'gasto' && !subscriptionNames.some(name => normalize(entry.movement.concepto).includes(name))).reduce((sum, entry) => sum + entry.movement.importe, 0);
  const monthsObserved = observedDays / 30.4;
  return { monthlyIncome: income / monthsObserved, dailyVariable: variableExpenses / observedDays, activeSubs, observedDays };
};

export const hasProjectionData = (movements: Movimiento[], subscriptions: Suscripcion[], now = new Date()) => Boolean(calculateProjectionEstimates(movements, subscriptions, now));

export const buildProjectionData = (startingBalance: number, estimates: ProjectionEstimates, now = new Date()) => {
  const data: Array<{ name: string; balance: number; rawDate: Date }> = [];
  let balance = startingBalance;
  for (let day = 0; day <= 90; day += 1) {
    const date = new Date(now); date.setDate(now.getDate() + day);
    if (day > 0) balance -= estimates.dailyVariable;
    if (day > 0 && date.getDate() === 28) balance += estimates.monthlyIncome;
    estimates.activeSubs.forEach(subscription => { const charge = getSubscriptionChargeForMonth(subscription, date.getFullYear(), date.getMonth(), now); if (day > 0 && charge?.getDate() === date.getDate()) balance -= getEffectiveSubscriptionAmount(subscription); });
    balance = Math.round(balance * 100) / 100;
    if (day % 3 === 0 || day === 90) data.push({ name: date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), balance, rawDate: date });
  }
  return data;
};
