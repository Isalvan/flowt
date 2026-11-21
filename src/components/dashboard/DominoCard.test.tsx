import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { DominoCard } from './DominoCard';

const privacy = vi.hoisted(() => ({ isLocked: false }));
beforeEach(() => { privacy.isLocked = false; });
vi.mock('../../context/PrivacyContext', () => ({
  usePrivacy: () => ({
    isLocked: privacy.isLocked,
    formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €`,
  }),
}));

const now = new Date('2026-11-20T12:00:00Z');
let seq = 0;
const gasto = (concepto: string, dia: number, hora: string, importe: number, mes = 10): Movimiento => ({
  id: `m${seq++}`, tipo: 'gasto', concepto, importe,
  fecha_operacion: `2026-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}T${hora}:00+02:00`,
});

/** Cine con cena y, aparte, otras parejas para la lista. */
function movimientos(parejas = 1): Movimiento[] {
  const lista: Movimiento[] = [];
  for (const dia of [1, 4, 8, 11, 15]) {
    lista.push(gasto('Cines Yelmo', dia, '19:00', 9));
    if (dia !== 15) lista.push(gasto('Taberna Sur', dia, '21:30', 30));
  }
  const otras = [['Gimnasio', 'Zumos Ya'], ['Ferretería', 'Bar Pepe'], ['Librería', 'Café Luna'], ['Museo', 'Tapas Ana'], ['Parking', 'Bolera']];
  // Cada pareja en su propio mes, para que no se mezclen entre sí.
  otras.slice(0, parejas - 1).forEach(([a, b], i) => {
    for (const dia of [2, 5, 9, 12]) lista.push(gasto(a, dia, '10:00', 5, 5 + i), gasto(b, dia, '10:30', 4 - i * 0.5, 5 + i));
  });
  for (const dia of [3, 6, 7, 10, 13, 14, 16, 17]) lista.push(gasto('Mercadona', dia, '11:00', 40));
  return lista;
}

describe('DominoCard', () => {
  it('cuenta lo que suele costar el plan y dibuja la cadena', () => {
    render(<DominoCard movimientos={movimientos()} now={now} />);
    expect(screen.getByText('Dominó')).toBeInTheDocument();
    expect(screen.getByText(/el plan te suele salir por/)).toHaveTextContent('Cuando compras en Cines Yelmo, el plan te suele salir por 33,00 €');
    expect(screen.getByText(/Allí pagas de media/)).toHaveTextContent('9,00 €; con lo que suele acompañarlo en el mismo rato, el conjunto sale 3,7 veces más caro.');
    const cadena = screen.getByLabelText('Cadena de Cines Yelmo');
    expect(cadena).toHaveTextContent('Cines Yelmo9,00 € · 5 veces');
    expect(cadena).toHaveTextContent('Taberna Sur8 de cada 10 · 30,00 €');
    expect(screen.getByText(/se fueron/)).toHaveTextContent('En esas 5 veces se fueron 120,00 € en lo que vino con Cines Yelmo.');
    expect(screen.getByText(/no\s+significa que una compra cause la otra/)).toBeInTheDocument();
  });

  it('lista las demás cadenas y despliega más de tres', () => {
    render(<DominoCard movimientos={movimientos(6)} now={now} />);
    expect(screen.getAllByText(/^con /)).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas' }));
    expect(screen.getAllByText(/^con /)).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Ver menos' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('no se muestra sin cadenas ni con la privacidad bloqueada', () => {
    const { container, rerender } = render(<DominoCard movimientos={[]} now={now} />);
    expect(container).toBeEmptyDOMElement();
    privacy.isLocked = true;
    rerender(<DominoCard movimientos={movimientos()} now={now} />);
    expect(container).toBeEmptyDOMElement();
  });
});
