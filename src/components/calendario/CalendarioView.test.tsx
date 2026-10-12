import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hucha, Movimiento, Suscripcion } from '../../types';
import { CalendarioView } from './CalendarioView';

const privacy = vi.hoisted(() => ({ isLocked: false }));
vi.mock('../../context/PrivacyContext', () => ({
  usePrivacy: () => ({
    isLocked: privacy.isLocked,
    formatCurrency: (value: number) => privacy.isLocked ? '•••• €' :
      `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(value)} €`,
  }),
}));

const movement = (id: string, day: number, importe: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, concepto: id, tipo: 'gasto', importe, fecha_operacion: new Date(2026, 9, day, 10), ...extra,
});
const sub: Suscripcion = {
  id: 'sub', nombre: 'Netflix', importe: 9.99, frecuencia: 'mensual', dia_pago: 20,
  activa: true, categoria: 'Ocio', color: '#ff0000', fecha_inicio: '2026-01-01',
};
const wallet: Hucha = { id: 'wallet', nombre: 'Principal', saldo_acumulado: 0, objetivo: null, tipo_aportacion: 'resto', orden: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 12));
  privacy.isLocked = false;
});
afterEach(() => vi.useRealTimers());

describe('CalendarioView', () => {
  it('shows the spent total and singular and plural upcoming charges in the subtitle', () => {
    const { rerender } = render(<CalendarioView movimientos={[movement('Gasto', 4, 42.3)]} suscripciones={[sub]} huchas={[]} />);
    expect(screen.getByRole('heading', { name: 'Calendario' })).toBeInTheDocument();
    expect(screen.getByText('Gastado 42,30 € · 1 cargo por venir')).toBeInTheDocument();
    rerender(<CalendarioView movimientos={[]} suscripciones={[sub, { ...sub, id: 'other' }]} huchas={[]} />);
    expect(screen.getByText('2 cargos por venir')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByText('2 cargos por venir')).toBeInTheDocument();
  });

  it('shows a rounded expense in its cell and precise amounts in its accessible label', () => {
    render(<CalendarioView movimientos={[movement('Gasto', 4, 42.3)]} suscripciones={[]} huchas={[]} />);
    const cell = screen.getByRole('button', { name: '4 de octubre, gastado 42,30 €' });
    expect(within(cell).getByText('−42 €')).toHaveClass('text-[11px]', 'font-bold', 'tabular-nums', 'text-ink');
    expect(cell).toHaveClass('bg-brand/[0.3]');
    expect(screen.getByText('Gastado 42,30 € · 0 cargos por venir')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5 de octubre, sin movimientos' })).toBeInTheDocument();
  });

  it('lists selected movements with statistical signed amounts, categories and wallet names', () => {
    render(<CalendarioView movimientos={[
      movement('Compra', 4, 20, { importe_neto: 12.5, categoria: 'alimentacion', hucha_id: wallet.id }),
      movement('Nómina recibida', 4, 2150, { tipo: 'ingreso', categoria: 'nomina', fecha_operacion: new Date(2026, 9, 4, 12) }),
    ]} suscripciones={[]} huchas={[wallet]} />);
    fireEvent.click(screen.getByRole('button', { name: '4 de octubre, gastado 12,50 €, ingresado 2.150,00 €' }));
    expect(screen.getByRole('heading', { name: '4 de octubre' })).toBeInTheDocument();
    expect(screen.getByText('Gastado 12,50 € · Ingresado 2.150,00 €')).toBeInTheDocument();
    expect(screen.getByText('Compra')).toBeInTheDocument();
    expect(screen.getByText(/ · Principal$/)).toBeInTheDocument();
    expect(screen.getByText('−12,50 €')).toHaveClass('text-ink');
    expect(screen.getByText('+2.150,00 €')).toHaveClass('text-emerald-600');
  });

  it('selects the costliest day from the month card', () => {
    render(<CalendarioView movimientos={[movement('Compra grande', 4, 86.2), movement('Café', 5, 2)]} suscripciones={[]} huchas={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Día más caro/ }));
    expect(screen.getByRole('button', { name: '4 de octubre, gastado 86,20 €' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Compra grande')).toBeInTheDocument();
    expect(screen.getByText('dom 4 · 86,20 €')).toBeInTheDocument();
  });

  it('shows the empty month and selected day states', () => {
    render(<CalendarioView movimientos={[]} suscripciones={[]} huchas={[]} />);
    expect(screen.getByText('Sin movimientos este mes')).toBeInTheDocument();
    expect(screen.getByText('Nada en este mes')).toBeInTheDocument();
    expect(screen.getByText('Sin movimientos este día')).toBeInTheDocument();
    expect(screen.queryByText('Media por día')).not.toBeInTheDocument();
  });

  it('masks currency everywhere, hides cell spending and removes intensity backgrounds when locked', () => {
    privacy.isLocked = true;
    const { container } = render(<CalendarioView movimientos={[movement('Compra', 4, 42.3)]} suscripciones={[sub]} huchas={[]} />);
    const cell = screen.getByRole('button', { name: '4 de octubre, gastado •••• €' });
    expect(cell).not.toHaveClass('bg-brand/[0.3]');
    expect(container.innerHTML).not.toMatch(/bg-brand\/\[0\./);
    expect(screen.queryByText('−42 €')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('42,30');
    fireEvent.click(cell);
    expect(screen.getByText('−•••• €')).toBeInTheDocument();
  });

  it('shows only remaining charges and the amount left to pay', () => {
    render(<CalendarioView movimientos={[movement('Pagado', 12, 9.99, { suscripcion_id: 'paid' })]} suscripciones={[
      sub, { ...sub, id: 'past', nombre: 'Pasado', dia_pago: 11 }, { ...sub, id: 'paid', nombre: 'Cobrado', dia_pago: 12 },
    ]} huchas={[]} />);
    expect(screen.getByText('Por venir')).toBeInTheDocument();
    expect(screen.queryByText('Pasado')).not.toBeInTheDocument();
    expect(screen.queryByText('Cobrado')).not.toBeInTheDocument();
    expect(screen.getByText('Queda por pagar').parentElement).toHaveTextContent('9,99 €');
    fireEvent.click(screen.getByRole('button', { name: '20 de octubre, 1 cargo previsto' }));
    expect(screen.getByText('Previsto')).toBeInTheDocument();
  });

  it('shows the predicted payday and usual payroll amount when selected', () => {
    render(<CalendarioView movimientos={[movement('Nómina anterior', 28, 2150, {
      tipo: 'ingreso', categoria: 'nomina', fecha_operacion: new Date(2026, 8, 28),
    })]} suscripciones={[]} huchas={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '28 de octubre, nómina prevista' }));
    expect(screen.getAllByText('Nómina prevista')).toHaveLength(2);
    expect(screen.getByText('+2.150,00 €')).toBeInTheDocument();
    expect(screen.queryByText('Sin movimientos este día')).not.toBeInTheDocument();
  });

  it('loads older history only when navigating before the oldest loaded month', () => {
    const loadOlderMovements = vi.fn();
    render(<CalendarioView movimientos={[movement('Antiguo', 4, 10, { fecha_operacion: new Date(2026, 8, 4) })]}
      suscripciones={[]} huchas={[]} loadOlderMovements={loadOlderMovements} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(loadOlderMovements).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(loadOlderMovements).toHaveBeenCalledTimes(1);
  });
});
