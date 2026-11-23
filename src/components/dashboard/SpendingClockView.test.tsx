import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { SpendingClockView } from './SpendingClockView';
import { AnalyticsSection } from './AnalyticsSection';

const privacy = vi.hoisted(() => ({
  isLocked: false,
  formatCurrency: (n: number) => `${n.toFixed(2).replace('.', ',')} €`,
}));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => privacy }));

// Datos inventados. En noviembre Madrid va en UTC+1.
let ids = 0;
const madrid = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, day, hour - 1, minute));
const gasto = (fecha: Date, importe = 10, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `g${ids++}`, tipo: 'gasto', concepto: 'Compra', importe, fecha_operacion: fecha, banco: 'Banco A', ...extra,
});
const evenings = Array.from({ length: 14 }, (_, i) => gasto(madrid(2 + (i % 7), 21, i), 20));
const mornings = Array.from({ length: 6 }, (_, i) => gasto(madrid(2 + i, 9, i), 5));

describe('SpendingClockView', () => {
  it('draws the 24-hour dial, highlights the costliest window and the peak weekday', () => {
    const { container } = render(<SpendingClockView movimientos={[...evenings, ...mornings]} />);
    expect(screen.getByRole('img', { name: 'Reloj de 24 horas: la franja con más gasto es 21:00–22:00' })).toBeInTheDocument();
    expect(container.querySelectorAll('path[data-hora]')).toHaveLength(24);
    expect([...container.querySelectorAll('path[data-pico]')].map(p => p.getAttribute('data-hora'))).toEqual(['21']);
    expect(screen.getByText('Entre las 21:00 y las 22:00 se va el 90 % de lo que gastas')).toBeInTheDocument();
    expect(screen.getAllByText('21:00–22:00 · 14 compras · 280,00 €').map(el => el.tagName)).toEqual(['title', 'SPAN']);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText(/La hora sale del aviso del banco: 20 de 20 gastos la traen/)).toBeInTheDocument();
  });

  it('falls back to weekdays when the notices bring no time', () => {
    const dateOnly = Array.from({ length: 10 }, (_, i) => gasto(new Date(Date.UTC(2026, 10, 2 + i)), 10 + i));
    render(<SpendingClockView movimientos={dateOnly} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Sin horas suficientes')).toBeInTheDocument();
    expect(screen.getByText(/Solo 0 de 10 gastos traen la hora/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Gasto medio por día de la semana' })).toBeInTheDocument();
    expect(screen.queryByText(/La hora sale del aviso/)).not.toBeInTheDocument();
  });

  it('names a bank whose times are ignored', () => {
    const batch = Array.from({ length: 8 }, (_, i) => gasto(madrid(2 + i, 6, 0), 10, { banco: 'Banco Lote' }));
    render(<SpendingClockView movimientos={[...evenings, ...batch]} />);
    expect(screen.getByText(/No uso la hora de Banco Lote: sus avisos llegan por lotes/)).toBeInTheDocument();
  });

  it('says so when the period has no expenses', () => {
    render(<SpendingClockView movimientos={[{ ...gasto(madrid(2, 10)), tipo: 'ingreso' }]} />);
    expect(screen.getByText('Aún no hay gastos en este periodo')).toBeInTheDocument();
  });
});

describe('AnalyticsSection clock mode', () => {
  const props = { chartData: [{ name: 'nov', ingresos: 100, gastos: 50 }], huchas: [], suscripciones: [], allMovimientos: [...evenings, ...mornings] };

  it('switches the card to the spending clock and back', () => {
    render(<AnalyticsSection {...props} />);
    const button = screen.getByRole('button', { name: 'Ver reloj del gasto' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Reloj del gasto')).toBeInTheDocument();
    expect(screen.getByText('A qué horas y qué días se te va el dinero')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Reloj de 24 horas/ })).toBeInTheDocument();
    expect(screen.queryByText('Ingresos')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver gráfico de área' }));
    expect(screen.getByText('Evolución de finanzas')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Reloj de 24 horas/ })).not.toBeInTheDocument();
  });

  it('keeps the clock hidden behind privacy and while the period loads', () => {
    privacy.isLocked = true;
    try {
      const view = render(<AnalyticsSection {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Ver reloj del gasto' }));
      expect(screen.getByText('Gráfica protegida por privacidad')).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: /Reloj de 24 horas/ })).not.toBeInTheDocument();
      privacy.isLocked = false;
      view.rerender(<AnalyticsSection {...props} periodStatus="loading" />);
      expect(screen.getByText('Cargando movimientos…')).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: /Reloj de 24 horas/ })).not.toBeInTheDocument();
    } finally { privacy.isLocked = false; }
  });
});
