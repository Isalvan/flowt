import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { CategoriesContext } from '../../context/categoryContext';
import { CategoryBreakdown } from './CategoryBreakdown';

const privacy = vi.hoisted(() => ({ isLocked: false }));
vi.mock('../../context/PrivacyContext', () => ({
  usePrivacy: () => ({
    isLocked: privacy.isLocked,
    formatCurrency: (value: number) => privacy.isLocked ? '•••• €' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value),
  }),
}));

const expense = (categoria: string | undefined, importe: number): Movimiento => ({
  id: categoria ?? 'missing', tipo: 'gasto', concepto: 'Gasto', categoria, importe, fecha_operacion: new Date(2026, 9, 1),
});
const currency = (value: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value).replace(/\s/g, ' ');

describe('CategoryBreakdown', () => {
  beforeEach(() => { privacy.isLocked = false; });
  afterEach(cleanup);

  it('shows category names, percentages, amounts and a summary of the largest categories', () => {
    render(
      <CategoriesContext.Provider value={{ custom: [{ id: 'custom', label: 'Mascotas', tipo: 'gasto' }] }}>
        <CategoryBreakdown allMovimientos={[expense('compras', 20), expense('custom', 30), expense(undefined, 50)]} periodLabel="Este mes" />
      </CategoriesContext.Provider>,
    );
    expect(screen.getByText('Este mes')).toBeInTheDocument();
    const list = screen.getByRole('list');
    for (const [label, amount] of [['Compras', 20], ['Mascotas', 30], ['Sin categoría', 50]] as const) {
      const row = within(list).getByText(label).closest('li')!;
      expect(within(row).getByText(currency(amount))).toBeInTheDocument();
      expect(within(row).getByText(`${amount} %`)).toBeInTheDocument();
    }
    expect(screen.getByRole('img')).toHaveAccessibleName('Gasto por categorías. Sin categoría: 50 %; Mascotas: 30 %; Compras: 20 %');
    expect(within(list).getByText(currency(100))).toBeInTheDocument();
    expect(screen.queryByText('Otras')).not.toBeInTheDocument();
  });

  it('groups the seventh and later categories into Otras', () => {
    const custom = Array.from({ length: 8 }, (_, index) => ({ id: `c${index}`, label: `Categoría ${index}`, tipo: 'gasto' as const }));
    const { rerender } = render(
      <CategoriesContext.Provider value={{ custom }}>
        <CategoryBreakdown allMovimientos={custom.map((category, index) => expense(category.id, 8 - index))} periodLabel="Este año" />
      </CategoriesContext.Provider>,
    );
    const row = screen.getByText('Otras').closest('li')!;
    expect(within(row).getByText(currency(3))).toBeInTheDocument();
    expect(within(row).getByText('8,33 %')).toBeInTheDocument();
    expect(screen.getByText('Categoría 5')).toBeInTheDocument();
    expect(screen.queryByText('Categoría 6')).not.toBeInTheDocument();
    expect(screen.queryByText('Categoría 7')).not.toBeInTheDocument();
    rerender(<CategoryBreakdown allMovimientos={custom.slice(0, 6).map(category => expense(category.id, 1))} periodLabel="Este año" />);
    expect(screen.queryByText('Otras')).not.toBeInTheDocument();
  });

  it('shows the usual empty state when there are no statistical expenses', () => {
    render(<CategoryBreakdown allMovimientos={[{ ...expense('compras', 10), es_interno: true }]} periodLabel="Este mes" />);
    expect(screen.getByText('Sin gastos en este periodo').parentElement).toHaveClass('dashboard-empty');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each(['loading', 'error'] as const)('shows the %s state instead of incomplete data', periodStatus => {
    render(<CategoryBreakdown allMovimientos={[expense('compras', 10)]} periodLabel="Histórico" periodStatus={periodStatus} />);
    const message = screen.getByText(periodStatus === 'loading' ? 'Cargando movimientos…' : 'No se pudieron cargar los movimientos históricos.');
    expect(message.parentElement).toHaveAttribute('aria-busy', String(periodStatus === 'loading'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('hides all figures and the chart when locked, even if movements are still present', () => {
    privacy.isLocked = true;
    render(<CategoryBreakdown allMovimientos={[expense('compras', 123.45)]} periodLabel="Este mes" />);
    expect(screen.getByText('Gráfica protegida por privacidad')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(/123|100 %|Gasto total/)).not.toBeInTheDocument();
  });
});
