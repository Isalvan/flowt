import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { WrappedCard } from './WrappedCard';

const d = (month: number, date = 1, year = 2026) => new Date(year, month - 1, date);
const fiveExpenses = (month = 10, year = 2026): Movimiento[] =>
  Array.from({ length: 5 }, (_, i) => ({
    id: `m-${year}-${month}-${i}`,
    tipo: 'gasto',
    concepto: 'Mercadona',
    importe: 20 + i,
    categoria: 'alimentacion',
    fecha_operacion: d(month, 5 + i, year),
  }));

describe('WrappedCard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('se muestra en los 10 primeros días del periodo nuevo y marca visto al abrir o pulsar Ahora no', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <WrappedCard movimientos={fiveExpenses(10)} now={d(11, 3)} inicioPeriodo={1} userId="u1" onOpen={onOpen} />,
    );
    expect(screen.getByRole('heading', { name: /Tu octubre ya está listo ✨/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ahora no/i }));
    expect(screen.queryByRole('heading', { name: /Tu octubre ya está listo ✨/i })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('flowt:wrapped-seen:u1') ?? '[]')).toEqual(['mes:2026-10']);

    localStorage.clear();
    rerender(
      <WrappedCard movimientos={fiveExpenses(10)} now={d(11, 4)} inicioPeriodo={1} userId="u2" onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ver mi Wrapped/i }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'mes:2026-10', label: 'octubre' }));
    expect(JSON.parse(localStorage.getItem('flowt:wrapped-seen:u2') ?? '[]')).toEqual(['mes:2026-10']);
  });

  it('no renderiza nada fuera de la ventana de 10 días ni cuando no hay suficientes gastos', () => {
    const { container } = render(
      <WrappedCard movimientos={fiveExpenses(10)} now={d(11, 12)} inicioPeriodo={1} onOpen={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('sigue mostrándose aunque localStorage falle', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<WrappedCard movimientos={fiveExpenses(10)} now={d(11, 3)} inicioPeriodo={1} onOpen={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Tu octubre ya está listo ✨/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ahora no/i }));
    expect(screen.queryByRole('heading', { name: /Tu octubre ya está listo ✨/i })).not.toBeInTheDocument();
  });
});
