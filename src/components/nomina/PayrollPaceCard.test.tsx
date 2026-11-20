import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PayrollPace } from '../../utils/payrollPace';
import { PayrollPaceCard } from './PayrollPaceCard';

const chart = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €` }) }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => { chart.data = data; return <div>{children}</div>; },
  Area: ({ name }: { name: string }) => <div data-testid="series" data-name={name} />,
  Line: ({ name, strokeDasharray }: { name: string; strokeDasharray?: string }) => <div data-testid="series" data-name={name} data-dash={strokeDasharray} />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

const pace = (extra: Partial<PayrollPace> = {}): PayrollPace => ({
  unidad: 'porcentaje', hoy: 5, libre: 1000, gastado: 30, actual: 3, fantasmaHoy: 6, diasDeVentaja: 3, alMenos: false, ciclos: 4, reglasActuales: false,
  puntos: [{ dia: 0, actual: 0, actualImporte: 0, fantasma: 1, banda: [0, 2] }, { dia: 1, actual: 1, actualImporte: 10, fantasma: 2, banda: [1, 3] }],
  ...extra,
});

describe('PayrollPaceCard', () => {
  it('says how far ahead you are and draws you, the ghost and its range', () => {
    render(<PayrollPaceCard pace={pace()} />);
    expect(screen.getByText('Vas 3 días por delante de tu ritmo habitual')).toBeInTheDocument();
    expect(screen.getByText('+3 días')).toBeInTheDocument();
    expect(screen.getByText('Llevas el 3 % de la parte libre; normalmente a estas alturas llevas el 6 %.')).toBeInTheDocument();
    expect(screen.getByText('Comparado con tus últimas 4 nóminas')).toBeInTheDocument();
    expect(screen.getAllByTestId('series').map(series => series.dataset.name)).toEqual(['Rango habitual', 'Habitual', 'Tú']);
    expect(chart.data).toHaveLength(2);
    expect(screen.queryByText(/reglas actuales/)).not.toBeInTheDocument();
  });

  it('says when you are behind, at the usual pace or past the history', () => {
    const { rerender } = render(<PayrollPaceCard pace={pace({ diasDeVentaja: -1, actual: 8 })} />);
    expect(screen.getByText('Vas 1 día por detrás de tu ritmo habitual')).toBeInTheDocument();
    expect(screen.getByText('−1 día')).toBeInTheDocument();
    rerender(<PayrollPaceCard pace={pace({ diasDeVentaja: 0 })} />);
    expect(screen.getByText('Vas a tu ritmo habitual')).toBeInTheDocument();
    rerender(<PayrollPaceCard pace={pace({ diasDeVentaja: 5, alMenos: true })} />);
    expect(screen.getByText('Vas más de 5 días por delante de tu ritmo habitual')).toBeInTheDocument();
    rerender(<PayrollPaceCard pace={pace({ diasDeVentaja: null, fantasmaHoy: null, hoy: 40 })} />);
    expect(screen.getByText('Este ciclo ya dura más que los anteriores')).toBeInTheDocument();
    rerender(<PayrollPaceCard pace={pace({ diasDeVentaja: null, hoy: 0 })} />);
    expect(screen.getByText('Acabas de cobrar: desde mañana verás tu ritmo')).toBeInTheDocument();
  });

  it('compares in euros when the payroll has no free part', () => {
    render(<PayrollPaceCard pace={pace({ unidad: 'euros', actual: 30, fantasmaHoy: 60 })} />);
    expect(screen.getByText('Llevas 30,00 € gastados; normalmente a estas alturas llevas 60,00 €.')).toBeInTheDocument();
  });

  it('shows an empty state without enough history, and warns about splits from current rules', () => {
    const { rerender } = render(<PayrollPaceCard pace={pace({ ciclos: 1, diasDeVentaja: null, fantasmaHoy: null })} />);
    expect(screen.getByText('Aún no hay con qué comparar')).toBeInTheDocument();
    expect(screen.queryByTestId('series')).not.toBeInTheDocument();
    rerender(<PayrollPaceCard pace={pace({ reglasActuales: true })} />);
    expect(screen.getByText(/calculada con tus reglas actuales/)).toBeInTheDocument();
  });
});
