import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FinancialOverview } from './FinancialOverview';
import { AnalyticsSection } from './AnalyticsSection';

const privacy = vi.hoisted(() => ({ isLocked: false }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => privacy }));
vi.mock('../../hooks/useCountUp', () => ({ useCountUp: (value: number) => value }));
vi.mock('../common/CountUp', () => ({ CountUp: ({ end }: { end: number }) => <span>{end}</span> }));

describe('unavailable period figures', () => {
  it('keeps the original heading without a featured wallet', () => {
    render(<FinancialOverview balance={4321} ingresos={0} gastos={0} />);
    expect(screen.getByText('Saldo actual').tagName).toBe('P');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('toggles between the featured wallet and total, including negative color and accent', () => {
    render(<FinancialOverview balance={4321} ingresos={0} gastos={0} featured={{ nombre: 'Ocio', saldo: -123, accent: 'bg-rose-500' }} />);
    const button = screen.getByRole('button', { name: 'Ver saldo total' });
    const figure = button.nextElementSibling!;
    expect(button).toHaveTextContent('Ocio');
    expect(button.querySelector('span[aria-hidden]')).toHaveClass('bg-rose-500');
    expect(figure).toHaveTextContent('-123,00 €');
    expect(figure).toHaveClass('text-rose-500');
    fireEvent.click(button);
    expect(button).toHaveTextContent('Saldo total');
    expect(button).toHaveAccessibleName('Ver Ocio');
    expect(figure).toHaveTextContent('4.321,00 €');
    expect(figure).toHaveClass('text-ink');
    expect(button.querySelector('span[aria-hidden]')).toBeNull();
    fireEvent.click(button);
    expect(figure).toHaveTextContent('-123,00 €');
  });

  it('allows toggling while both balances stay hidden', () => {
    privacy.isLocked = true;
    try {
      render(<FinancialOverview balance={4321} ingresos={0} gastos={0} featured={{ nombre: 'Ocio', saldo: 123, accent: 'bg-rose-500' }} />);
      const button = screen.getByRole('button', { name: 'Ver saldo total' });
      expect(button.nextElementSibling).toHaveTextContent('•••• €');
      fireEvent.click(button);
      expect(button).toHaveTextContent('Saldo total');
      expect(button.nextElementSibling).toHaveTextContent('•••• €');
    } finally { privacy.isLocked = false; }
  });
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
