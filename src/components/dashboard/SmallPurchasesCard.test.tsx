import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { SmallPurchasesCard } from './SmallPurchasesCard';

const privacy = vi.hoisted(() => ({ isLocked: false }));
const prefs = vi.hoisted(() => ({ umbralCompraPequena: 5 }));

beforeEach(() => {
  privacy.isLocked = false;
  prefs.umbralCompraPequena = 5;
});

vi.mock('../../context/PrivacyContext', () => ({
  usePrivacy: () => ({
    isLocked: privacy.isLocked,
    formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €`,
  }),
}));

vi.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({
    horasSemanales: null,
    umbralCompraPequena: prefs.umbralCompraPequena,
    updatePreferences: vi.fn(),
  }),
}));

const makeGasto = (id: string, concepto: string, importe: number): Movimiento => ({
  id,
  tipo: 'gasto',
  concepto,
  importe,
  fecha_operacion: new Date('2026-10-05'),
});

describe('SmallPurchasesCard', () => {
  it('no se pinta si no hay ninguna compra pequeña en el periodo', () => {
    const movimientos = [
      makeGasto('1', 'Alquiler', 600),
      makeGasto('2', 'Supermercado grande', 80),
    ];

    const { container } = render(
      <SmallPurchasesCard
        movimientos={movimientos}
        periodLabel="Este mes"
        totalGastos={680}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('no se pinta con la app bloqueada', () => {
    privacy.isLocked = true;
    const movimientos = [makeGasto('1', 'Café', 1.8)];

    const { container } = render(
      <SmallPurchasesCard
        movimientos={movimientos}
        periodLabel="Este mes"
        totalGastos={100}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('muestra cifras correctas: total, recuento, porcentaje y subtítulo', () => {
    // 43 compras de 1,05 € suman 45,15 € sobre un gasto total de 500 € (9 % de tu gasto)
    const movimientos: Movimiento[] = [];
    for (let i = 1; i <= 43; i++) {
      movimientos.push(makeGasto(String(i), `Kiosco ${i % 3}`, 1.05));
    }

    render(
      <SmallPurchasesCard
        movimientos={movimientos}
        periodLabel="Este mes"
        totalGastos={500}
      />,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Compras pequeñas' })).toBeInTheDocument();
    expect(screen.getByText('Menos de 5 € · este mes')).toBeInTheDocument();
    expect(screen.getByText('45,15 €')).toBeInTheDocument();
    expect(screen.getByText('43 compras')).toBeInTheDocument();
    expect(screen.getByText('9 % de tu gasto')).toBeInTheDocument();
  });

  it('muestra solo los 3 primeros comercios y un botón para ver el resto', () => {
    const movimientos = [
      makeGasto('1', 'Panadería', 4.5),
      makeGasto('2', 'Cafetería', 3.5),
      makeGasto('3', 'Kiosco', 2.5),
      makeGasto('4', 'Librería', 2.0),
      makeGasto('5', 'Farmacia', 1.5),
    ];

    render(
      <SmallPurchasesCard
        movimientos={movimientos}
        periodLabel="Este mes"
        totalGastos={100}
      />,
    );

    expect(screen.getByText('Panadería')).toBeInTheDocument();
    expect(screen.getByText('Cafetería')).toBeInTheDocument();
    expect(screen.getByText('Kiosco')).toBeInTheDocument();
    expect(screen.queryByText('Librería')).not.toBeInTheDocument();
    expect(screen.queryByText('Farmacia')).not.toBeInTheDocument();

    const toggleButton = screen.getByRole('button', { name: 'Ver todos' });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

    // Despliega la lista
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    expect(toggleButton).toHaveTextContent('Ver menos');
    expect(screen.getByText('Librería')).toBeInTheDocument();
    expect(screen.getByText('Farmacia')).toBeInTheDocument();

    // Repliega la lista
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    expect(toggleButton).toHaveTextContent('Ver todos');
    expect(screen.queryByText('Librería')).not.toBeInTheDocument();
    expect(screen.queryByText('Farmacia')).not.toBeInTheDocument();
  });

  it('no muestra el botón Ver todos si hay 3 comercios o menos', () => {
    const movimientos = [
      makeGasto('1', 'Café', 1.5),
      makeGasto('2', 'Pan', 1.0),
    ];

    render(
      <SmallPurchasesCard
        movimientos={movimientos}
        periodLabel="Este mes"
        totalGastos={50}
      />,
    );

    expect(screen.getByText('Café')).toBeInTheDocument();
    expect(screen.getByText('Pan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver todos/i })).not.toBeInTheDocument();
  });

  it('usa singular para una sola compra y adapta el subtítulo al periodo en minúsculas', () => {
    prefs.umbralCompraPequena = 10;
    const movimientos = [makeGasto('1', 'Café', 2.0)];

    render(
      <SmallPurchasesCard
        movimientos={movimientos}
        periodLabel="Histórico"
        totalGastos={200}
      />,
    );

    expect(screen.getByText('Menos de 10 € · histórico')).toBeInTheDocument();
    expect(screen.getAllByText('1 compra')).toHaveLength(2);
    expect(screen.getByText('1 % de tu gasto')).toBeInTheDocument();
  });
});
