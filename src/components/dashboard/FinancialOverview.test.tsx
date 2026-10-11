import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FinancialOverview } from './FinancialOverview';
import { AnalyticsSection } from './AnalyticsSection';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false }) }));
vi.mock('../../hooks/useCountUp', () => ({ useCountUp: (value: number) => value }));
vi.mock('../common/CountUp', () => ({ CountUp: ({ end }: { end: number }) => <span>{end}</span> }));

describe('unavailable period figures', () => {
  it.each(['loading', 'error'] as const)('keeps the balance and replaces period figures during %s', periodStatus => {
    render(<FinancialOverview balance={4321} ingresos={1700} gastos={150} trend={[100, 200]} periodStatus={periodStatus} />);
    const overview = screen.getByRole('region', { name: 'Resumen financiero' });
    expect(overview).toHaveTextContent('4.321,00 €');
    expect(within(overview).getAllByText('—')).toHaveLength(2);
    expect(overview).not.toHaveTextContent('1700');
    expect(overview).not.toHaveTextContent('150');
    expect(screen.queryByRole('img', { name: 'Evolución de tu saldo en el periodo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole(periodStatus === 'error' ? 'alert' : 'status')).toHaveTextContent(
      periodStatus === 'error' ? 'No se pudieron cargar los movimientos históricos.' : 'Cargando movimientos…',
    );
  });

  it('restores figures, trend and spent meter when the period becomes available', () => {
    const view = render(<FinancialOverview balance={4321} ingresos={1700} gastos={150} trend={[100, 200]} periodStatus="loading" />);
    view.rerender(<FinancialOverview balance={4321} ingresos={1700} gastos={150} trend={[100, 200]} />);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.getByText('1700')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Evolución de tu saldo en el periodo' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it.each(['loading', 'error'] as const)('keeps the chart viewport and card chrome during %s', periodStatus => {
    render(<AnalyticsSection chartData={[{ name: 'oct', ingresos: 1700, gastos: 150 }]} huchas={[]} suscripciones={[]} allMovimientos={[]} periodStatus={periodStatus} />);
    const message = screen.getByText(periodStatus === 'error' ? 'No se pudieron cargar los movimientos históricos.' : 'Cargando movimientos…');
    expect(message.parentElement).toHaveClass('dashboard-empty', 'h-full');
    expect(message.parentElement?.parentElement).toHaveClass('h-64');
    expect(message.closest('section')).toHaveClass('dashboard-surface');
    expect(screen.getByText('Evolución de finanzas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver gráfico de área' })).toBeInTheDocument();
  });
});
