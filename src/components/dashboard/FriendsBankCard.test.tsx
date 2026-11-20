import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { FriendsBankCard } from './FriendsBankCard';

const privacy = vi.hoisted(() => ({ isLocked: false }));
vi.mock('../../context/PrivacyContext', () => ({
  usePrivacy: () => ({ isLocked: privacy.isLocked, formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €` }),
}));

// Nombres e importes inventados.
const now = new Date('2026-06-30T12:00:00Z');
let seq = 0;
const mov = (extra: Partial<Movimiento>): Movimiento => ({
  id: `m${++seq}`, tipo: 'ingreso', concepto: '', importe: 10, fecha_operacion: '2026-06-01T10:00:00Z', ...extra,
});

const movimientos: Movimiento[] = [
  mov({ id: 'cena', tipo: 'gasto', concepto: 'Asador', importe: 60, fecha_operacion: '2026-06-10T21:00:00Z',
    ticket: { comercio: 'Asador', lineas: [], personas: [{ nombre: 'Yo', importe: 20, yo: true }, { nombre: 'Pablo', importe: 20 }, { nombre: 'Nora', importe: 20 }] } }),
  mov({ concepto: 'pablo ortega vidal', importe: 20, fecha_operacion: '2026-06-12T09:00:00Z', compensa_movimiento_id: 'cena' }),
  mov({ concepto: 'lucia ferrer campos', importe: 35 }),
  mov({ tipo: 'gasto', concepto: 'Bizum entradas Lucia', importe: 15 }),
  mov({ tipo: 'gasto', concepto: 'bizum:regalo', importe: 5 }),
];

describe('FriendsBankCard', () => {
  it('says who owes you, what each person moved and what the bank cannot tell', () => {
    render(<FriendsBankCard movimientos={movimientos} now={now} />);
    expect(screen.getByText('Te deben 20,00 € entre 1 persona')).toBeInTheDocument();
    expect(screen.getByText('55,00 €')).toBeInTheDocument();
    expect(screen.getByText('Te debe 20,00 €')).toBeInTheDocument();
    expect(screen.getByLabelText('Pendiente de Nora')).toHaveTextContent('Asador · 10 jun · 20,00 €');
    expect(screen.getByText('Pablo Ortega Vidal')).toBeInTheDocument();
    expect(screen.getByText('Te devuelve en 2 días')).toBeInTheDocument();
    expect(screen.getByText('Al día')).toBeInTheDocument();
    expect(screen.getByText(/Le has enviado 15,00 €/)).toBeInTheDocument();
    expect(screen.getByText(/1 Bizum enviado sin nombre/)).toBeInTheDocument();
  });

  it('shows the rest of the people on demand', () => {
    const many = ['ana', 'bea', 'carla', 'diana', 'elena'].map(n => mov({ concepto: `${n} ruiz mora` }));
    render(<FriendsBankCard movimientos={many} now={now} />);
    expect(screen.queryByText('Elena Ruiz Mora')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver las 5 personas' }));
    expect(screen.getByText('Elena Ruiz Mora')).toBeInTheDocument();
    expect(screen.getByText('Nadie te debe nada')).toBeInTheDocument();
  });

  it('hides itself with the privacy lock or without people', () => {
    const { container, rerender } = render(<FriendsBankCard movimientos={[mov({ concepto: 'Nómina', categoria: 'nomina' })]} now={now} />);
    expect(container).toBeEmptyDOMElement();
    privacy.isLocked = true;
    rerender(<FriendsBankCard movimientos={movimientos} now={now} />);
    expect(container).toBeEmptyDOMElement();
    privacy.isLocked = false;
  });
});
