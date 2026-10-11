import { type Suscripcion } from '../../types';
import { getMonthlySubscriptionAmount } from '../../utils/subscriptions';


// Standard fallback configurations and options
export const SUBSCRIPTION_COLORS = [
  '#8b5cf6', '#ec4899', '#3b82f6', '#0ea5e9', '#14b8a6',
  '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#6366f1',
];

export const FRECUENCIA_OPTIONS = [
  { value: 'mensual', label: 'Mensual', divisor: 1 },
  { value: 'trimestral', label: 'Trimestral', divisor: 3 },
  { value: 'semestral', label: 'Semestral', divisor: 6 },
  { value: 'anual', label: 'Anual', divisor: 12 },
];

export const CATEGORIA_OPTIONS = [
  { value: 'streaming', label: 'Streaming' },
  { value: 'musica', label: 'Música' },
  { value: 'software', label: 'Software' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'noticias', label: 'Noticias' },
  { value: 'otros', label: 'Otros' },
];

export const calcMensual = (s: Suscripcion): number => {
  return getMonthlySubscriptionAmount(s);
};