import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Suscripcion } from '../../types';
import { SuscripcionesView } from './SuscripcionesView';

vi.mock('../../context/PrivacyContext', () => ({
  usePrivacy: () => ({
    formatCurrency: (value: number) => `${value.toFixed(2)} €`,
  }),
}));

const subscription = (id: string, overrides: Partial<Suscripcion> = {}): Suscripcion => ({
  id, nombre: id, importe: 10, frecuencia: 'mensual', dia_pago: 1,
  categoria: 'otros', color: '#000000', activa: true, ...overrides,
});
const props = {
  huchas: [],
  onOpenSuscripcionModal: vi.fn(),
  onDeleteSuscripcion: vi.fn(),
  onToggleSuscripcion: vi.fn(),
  onCancelSuscripcion: vi.fn(),
  onUndoCancelSuscripcion: vi.fn(),
};
const annualSummary = () => screen.getByText('Coste anual').parentElement!;
const card = (name: string) => screen.getByRole('heading', { name }).closest('.dashboard-surface')! as HTMLElement;

describe('SuscripcionesView', () => {
  it('suma solo las activas y las ordena por coste anual conservando el orden de las inactivas', () => {
    const suscripciones = [
      subscription('Pausada primera', { activa: false, importe: 1000 }),
      subscription('Compartida', { importe: 100, mi_parte: 5 }),
      subscription('Anual', { frecuencia: 'anual', importe: 180, categoria: 'musica', cancelando: true }),
      subscription('Mensual'),
      subscription('Pausada segunda', { activa: false, importe: 2000 }),
    ];
    const originalOrder = suscripciones.map(s => s.id);
    render(<SuscripcionesView {...props} suscripciones={suscripciones} ingresoMensualHabitual={1000} />);
    expect(annualSummary()).toHaveTextContent('360.00 €');
    expect(annualSummary()).toHaveTextContent('3 % de lo que ingresas');
    expect(screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent)).toEqual([
      'Anual', 'Mensual', 'Compartida', 'Pausada primera', 'Pausada segunda',
    ]);
    expect(suscripciones.map(s => s.id)).toEqual(originalOrder);
    expect(within(card('Compartida')).getByText('60.00 € al año')).toBeInTheDocument();
    expect(within(card('Compartida')).getByText('16,7 % de tus suscripciones')).toBeInTheDocument();
    expect(within(card('Pausada primera')).queryByText(/al año|de tus suscripciones/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Música' }));
    expect(within(card('Anual')).getByText('50 % de tus suscripciones')).toBeInTheDocument();
    expect(annualSummary()).toHaveTextContent('360.00 €');
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('omite el porcentaje sin ingreso válido (%s)', ingresoMensualHabitual => {
    render(<SuscripcionesView {...props} suscripciones={[]} ingresoMensualHabitual={ingresoMensualHabitual} />);
    expect(annualSummary()).toHaveTextContent('0.00 €');
    expect(screen.queryByText(/de lo que ingresas/)).not.toBeInTheDocument();
  });

  it('muestra un peso de cero cuando el total activo es cero', () => {
    render(<SuscripcionesView {...props} suscripciones={[subscription('Gratis', { mi_parte: 0 })]} />);
    expect(within(card('Gratis')).getByText('0.00 € al año')).toBeInTheDocument();
    expect(within(card('Gratis')).getByText('0 % de tus suscripciones')).toBeInTheDocument();
  });
});
