import type React from 'react';
import {
  Calendar, ChartColumn, Clock, Coffee, Compass, Crown, Flame, Heart, House, Moon, Receipt, Repeat,
  ShoppingBag, Sparkles, Store, Tag, Target, Ticket, TrendingDown, TrendingUp, Trophy, Utensils, Wallet, Zap,
} from 'lucide-react';
import type { WrappedFormat, WrappedIcon } from '../../utils/wrapped';

export const ICONS: Record<WrappedIcon, React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>> = {
  'trend-up': TrendingUp,
  'trend-down': TrendingDown,
  coffee: Coffee,
  calendar: Calendar,
  store: Store,
  sparkles: Sparkles,
  repeat: Repeat,
  moon: Moon,
  tag: Tag,
  receipt: Receipt,
  flame: Flame,
  trophy: Trophy,
  compass: Compass,
  heart: Heart,
  zap: Zap,
  utensils: Utensils,
  ticket: Ticket,
  wallet: Wallet,
  home: House,
  crown: Crown,
  target: Target,
  clock: Clock,
  bag: ShoppingBag,
  chart: ChartColumn,
};

export const delay = (d: number) => ({ '--d': d }) as React.CSSProperties;

export interface VisualEnv {
  reducedMotion: boolean;
  formatCurrency: (value: number) => string;
}

export const formatValue = (value: number, formato: WrappedFormat | undefined, env: VisualEnv) =>
  formato === 'dinero' ? env.formatCurrency(value)
    : formato === 'pct' ? `${Math.round(value)} %`
      : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value);

