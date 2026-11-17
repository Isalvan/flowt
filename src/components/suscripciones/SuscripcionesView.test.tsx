import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento, Suscripcion } from '../../types';
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

describe('avisos de suscripciones', () => {
  const props = () => ({
    suscripciones: [] as Suscripcion[], huchas: [], userId: 'test-alerts',
    onOpenSuscripcionModal: vi.fn(), onDeleteSuscripcion: vi.fn(), onToggleSuscripcion: vi.fn(),
    onCancelSuscripcion: vi.fn(), onUndoCancelSuscripcion: vi.fn(), onUpdateSuscripcion: vi.fn().mockResolvedValue(undefined),
  });
  const movements = (): Movimiento[] => [2, 1, 0].map(offset => {
    const date = new Date();
    date.setDate(1); date.setMonth(date.getMonth() - offset);
    return { id: `gym-${offset}`, tipo: 'gasto', concepto: 'Gimnasio X', importe: 29.9, fecha_operacion: date };
  });
  const sub: Suscripcion = { id: 'netflix', nombre: 'Netflix', importe: 12.99, frecuencia: 'mensual', dia_pago: 1, categoria: 'ocio', color: '#000', activa: true, mi_parte: 5 };
  const priceMovement = (): Movimiento => ({ id: 'price-test', tipo: 'gasto', concepto: 'Netflix', importe: 13.99, fecha_operacion: new Date(), suscripcion_id: 'netflix' });
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('renderiza y descarta el aviso, conservándolo al volver y aislándolo por usuario', () => {
    const p = props();
    const { unmount } = render(<SuscripcionesView {...p} movimientos={movements()} />);
    expect(screen.getByRole('region', { name: 'Avisos' })).toHaveTextContent('Gimnasio X');
    expect(screen.getByRole('region', { name: 'Avisos' })).toHaveTextContent('desde hace 3 meses');
    fireEvent.click(screen.getByRole('button', { name: 'No es una suscripción' }));
    expect(screen.queryByRole('region', { name: 'Avisos' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('flowt:recurring-dismissed:test-alerts')!)).toEqual(['new:gimnasio x']);
    unmount();
    const { rerender } = render(<SuscripcionesView {...p} movimientos={movements()} />);
    expect(screen.queryByRole('region', { name: 'Avisos' })).not.toBeInTheDocument();
    rerender(<SuscripcionesView {...p} userId="other-user" movimientos={movements()} />);
    expect(screen.getByRole('region', { name: 'Avisos' })).toBeInTheDocument();
  });
  it('abre el modal como alta con el borrador y la hucha de suscripciones', () => {
    const p = props();
    render(<SuscripcionesView {...p} movimientos={movements()} huchas={[{ id: 'subs', nombre: 'Suscripciones', saldo_acumulado: 0, objetivo: null, tipo_aportacion: 'flat', orden: 0, es_suscripciones: true }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Añadir como suscripción' }));
    expect(p.onOpenSuscripcionModal).toHaveBeenCalledWith(null, expect.objectContaining({
      nombre: 'Gimnasio X', importe: 29.9, frecuencia: 'mensual', dia_pago: 1, hucha_id: 'subs',
    }));
  });
  it('actualiza el total sin cambiar mi_parte y avisa de revisarla', async () => {
    const p = props();
    render(<SuscripcionesView {...p} suscripciones={[sub]} movimientos={[priceMovement()]} />);
    expect(screen.getByRole('region', { name: 'Avisos' })).toHaveTextContent('ha subido de');
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar importe' }));
    await waitFor(() => expect(p.onUpdateSuscripcion).toHaveBeenCalledWith({ ...sub, importe: 13.99 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Revisa tu parte');
    expect(screen.queryByRole('region', { name: 'Avisos' })).not.toBeInTheDocument();
  });
  it('permite ignorar una subida concreta', () => {
    render(<SuscripcionesView {...props()} suscripciones={[sub]} movimientos={[priceMovement()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ignorar' }));
    expect(screen.queryByRole('region', { name: 'Avisos' })).not.toBeInTheDocument();
    expect(localStorage.getItem('flowt:recurring-dismissed:test-alerts')).toContain('price:netflix:price-test');
  });
  it('mantiene el aviso si falla la actualización', async () => {
    const p = props(); p.onUpdateSuscripcion.mockRejectedValue(new Error('save failed'));
    render(<SuscripcionesView {...p} suscripciones={[sub]} movimientos={[priceMovement()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar importe' }));
    expect(await screen.findByRole('status')).toHaveTextContent('No se ha podido');
    expect(screen.getByRole('region', { name: 'Avisos' })).toBeInTheDocument();
  });
  it('actualiza el total conservando mi_parte y retira el aviso; otro cobro vuelve a avisar', async () => {
    const p = props();
    const { rerender } = render(<SuscripcionesView {...p} suscripciones={[sub]} movimientos={[priceMovement()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar importe' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Avisos' })).not.toBeInTheDocument());
    expect(p.onUpdateSuscripcion).toHaveBeenCalledWith(expect.objectContaining({ id: 'netflix', importe: 13.99, mi_parte: 5 }));
    expect(screen.getByRole('status')).toHaveTextContent('Revisa tu parte');
    rerender(<SuscripcionesView {...p} suscripciones={[sub]} movimientos={[priceMovement(), { ...priceMovement(), id: 'price-test-next' }]} />);
    expect(screen.getByRole('region', { name: 'Avisos' })).toBeInTheDocument();
  });
  it('funciona si el almacenamiento está bloqueado', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<SuscripcionesView {...props()} userId="storage-unavailable" movimientos={movements()} />);
    fireEvent.click(screen.getByRole('button', { name: 'No es una suscripción' }));
    expect(screen.queryByRole('region', { name: 'Avisos' })).not.toBeInTheDocument();
  });
  it('tolera descartes corruptos', () => {
    localStorage.setItem('flowt:recurring-dismissed:test-alerts', '{invalid');
    render(<SuscripcionesView {...props()} movimientos={movements()} />);
    expect(screen.getByRole('region', { name: 'Avisos' })).toBeInTheDocument();
  });
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
