import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { MoneyFlowCard } from './MoneyFlowCard';

const privacy = vi.hoisted(() => ({ isLocked: false }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({
  isLocked: privacy.isLocked,
  formatCurrency: (amount: number) => `${amount.toFixed(2).replace('.', ',')} €`,
}) }));
const suggestCategory = vi.fn();
vi.mock('../../hooks/useCategories', () => ({ useCategories: () => ({ categoryLabel: (id: string) => id === 'compras' ? 'Compras' : id, suggestCategory }) }));
const movements: Movimiento[] = [
  { id: 'income', tipo: 'ingreso', importe: 100, categoria: 'nomina', concepto: 'Private employer', fecha_operacion: new Date() },
  { id: 'expense', tipo: 'gasto', importe: 25, categoria: 'compras', concepto: 'Private shop', fecha_operacion: new Date() },
];

describe('MoneyFlowCard', () => {
  beforeEach(() => {
    privacy.isLocked = false;
    suggestCategory.mockReset();
    vi.stubGlobal('ResizeObserver', class {
      private callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) { this.callback = callback; }
      observe() { this.callback([{ contentRect: { width: 600, height: 288 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('hides the chart, amounts and sharing when locked', () => {
    privacy.isLocked = true;
    render(<MoneyFlowCard allMovimientos={movements} periodLabel="Este mes" />);
    expect(screen.getByText('Gráfica protegida por privacidad')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compartir sin importes' })).not.toBeInTheDocument();
    expect(screen.queryByText(/100,00/)).not.toBeInTheDocument();
  });
  it('shows the empty state', () => {
    render(<MoneyFlowCard allMovimientos={[]} periodLabel="Este mes" />);
    expect(screen.getByText('Sin movimientos en este periodo').parentElement).toHaveClass('h-72');
  });
  it.each(['loading', 'error'] as const)('shows the %s state', periodStatus => {
    render(<MoneyFlowCard allMovimientos={movements} periodLabel="Este mes" periodStatus={periodStatus} />);
    expect(screen.getByText(periodStatus === 'loading' ? 'Cargando movimientos…' : 'No se pudieron cargar los movimientos históricos.').parentElement)
      .toHaveAttribute('aria-busy', String(periodStatus === 'loading'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('shows names, percentages and amounts, and opens the share preview', () => {
    render(<MoneyFlowCard allMovimientos={movements} periodLabel="Este mes" />);
    const chart = screen.getByRole('img');
    expect(chart).toHaveAttribute('width', '600');
    expect(within(chart).getByText('Nómina')).toBeInTheDocument();
    expect(within(chart).getByText('Compras')).toBeInTheDocument();
    expect(chart).toHaveTextContent('25 % · 25,00 €');
    expect(screen.getByRole('list')).toHaveTextContent('Sin gastar: 75 %, 75,00 €');
    fireEvent.click(screen.getByRole('button', { name: 'Compartir sin importes' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Compartir tu flujo');
    const preview = screen.getByAltText('Vista previa de la imagen');
    expect(decodeURIComponent(preview.getAttribute('src')!)).not.toMatch(/€|Private employer|Private shop/);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('uses confident suggestions but leaves low confidence uncategorised', () => {
    suggestCategory.mockReturnValue({ categoria: 'compras', confianza: 'media' });
    const { rerender } = render(<MoneyFlowCard allMovimientos={[{ ...movements[1], categoria: undefined }]} periodLabel="Este mes" />);
    expect(within(screen.getByRole('img')).getByText('Compras')).toBeInTheDocument();
    suggestCategory.mockReturnValue({ categoria: 'compras', confianza: 'baja' });
    rerender(<MoneyFlowCard allMovimientos={[{ ...movements[1], categoria: undefined }]} periodLabel="Este mes" />);
    expect(within(screen.getByRole('img')).getByText('Sin categoría')).toBeInTheDocument();
  });
});
