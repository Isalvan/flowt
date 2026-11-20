import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { PersonalInflationCard } from './PersonalInflationCard';

const privacy = vi.hoisted(() => ({ isLocked: false }));
vi.mock('../../context/PrivacyContext', () => ({
  usePrivacy: () => ({ isLocked: privacy.isLocked, formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €` }),
}));

// Fictitious places and prices.
const now = new Date(2026, 10, 20, 18);
let ids = 0;
const visits = (start: Date, concepto: string, amounts: number[]): Movimiento[] => amounts.map((importe, index) => ({
  id: `m${ids++}`, tipo: 'gasto', concepto, importe,
  fecha_operacion: new Date(start.getFullYear(), start.getMonth(), start.getDate() + index * 7, 12),
}));
const lastYear = new Date(2025, 9, 1);
const recent = new Date(2026, 8, 1);
const place = (name: string, before: number, after: number) =>
  [...visits(lastYear, name, [before, before, before]), ...visits(recent, name, [after, after, after])];

describe('PersonalInflationCard', () => {
  it('shows your index, what it costs a month and each place', () => {
    render(<PersonalInflationCard now={now} movimientos={[...place('Super Norte', 40, 44), ...place('Bar El Puerto', 10, 9)]} />);
    // 3 × 44 + 3 × 9 = 159 against 3 × 40 + 3 × 10 = 150: 6 % more, 9 € more in 90 days.
    expect(screen.getByText('+6 %')).toBeInTheDocument();
    expect(screen.getByText('Pagas un 6 % más que hace un año')).toBeInTheDocument();
    expect(screen.getByText('Por las mismas visitas, unos 3,00 € más al mes.')).toBeInTheDocument();
    expect(screen.getByText('Super Norte')).toBeInTheDocument();
    expect(screen.getByText('40,00 € → 44,00 € por visita · 3 visitas')).toBeInTheDocument();
    expect(screen.getByText('−10 %')).toBeInTheDocument();
    expect(screen.getByText(/del 1 oct 2025 al 20 dic 2025 con los últimos 90 días/)).toBeInTheDocument();
  });

  it('says when you pay less, and lists the rest on demand', () => {
    const many = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'].flatMap((name, index) => place(`Sitio ${name}`, 20, 18 - index * 0.01));
    render(<PersonalInflationCard now={now} movimientos={many} />);
    expect(screen.getByText(/^Pagas un 10,\d % menos que hace un año$/)).toBeInTheDocument();
    expect(screen.queryByText('Sitio Uno')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver los 6 sitios' }));
    expect(screen.getByText('Sitio Uno')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver menos' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says when prices have not moved', () => {
    render(<PersonalInflationCard now={now} movimientos={[...place('Super Norte', 40, 40), ...place('Bar El Puerto', 10, 10)]} />);
    expect(screen.getByText('Pagas lo mismo que hace un año')).toBeInTheDocument();
    expect(screen.queryByText(/al mes/)).not.toBeInTheDocument();
  });

  it('shows nothing without enough places or while privacy is locked', () => {
    const { container, rerender } = render(<PersonalInflationCard now={now} movimientos={place('Super Norte', 40, 44)} />);
    expect(container).toBeEmptyDOMElement();
    privacy.isLocked = true;
    rerender(<PersonalInflationCard now={now} movimientos={[...place('Super Norte', 40, 44), ...place('Bar El Puerto', 10, 9)]} />);
    expect(container).toBeEmptyDOMElement();
    privacy.isLocked = false;
  });
});
