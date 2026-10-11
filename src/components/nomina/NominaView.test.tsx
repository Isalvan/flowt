import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hucha, Movimiento, Suscripcion } from '../../types';
import { NominaView } from './NominaView';

const privacy = vi.hoisted(() => ({ isLocked: false, openUnlockModal: vi.fn(), formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €` }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => privacy }));
const huchas: Hucha[] = [
  { id: 'free', nombre: 'Día a día', tipo_aportacion: 'resto', saldo_acumulado: 0, objetivo: null, orden: 0 },
  { id: 'subs', nombre: 'Servicios', tipo_aportacion: 'flat', es_suscripciones: true, saldo_acumulado: 0, objetivo: null, orden: 1 },
];
const movimientos: Movimiento[] = [
  { id: 'current', tipo: 'ingreso', concepto: 'Nómina', categoria: 'nomina', importe: 2000, fecha_operacion: new Date(2026, 8, 28), reparto_aplicado: { saldos: { free: 1400, subs: 100, save: 500 }, deudas: {} } },
  { id: 'previous', tipo: 'ingreso', concepto: 'Nómina', categoria: 'nomina', importe: 1900, fecha_operacion: new Date(2026, 7, 28) },
  { id: 'expense', tipo: 'gasto', concepto: 'Compra', importe: 200, fecha_operacion: new Date(2026, 9, 1) },
];
const suscripciones: Suscripcion[] = [{ id: 'netflix', nombre: 'Netflix', importe: 10, dia_pago: 16, frecuencia: 'mensual', fecha_inicio: '2026-01-16', categoria: 'ocio', color: '#ff0000', activa: true }];
const renderView = (movements = movimientos, subs = suscripciones) => render(<NominaView movimientos={movements} huchas={huchas} suscripciones={subs} />);
const card = (title: string) => within(screen.getByText(title).closest('section')!);

describe('NominaView', () => {
  beforeEach(() => {
    privacy.isLocked = false;
    privacy.openUnlockModal.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 12));
  });
  afterEach(() => vi.useRealTimers());
  it('hides all financial data when locked and opens the unlock modal', () => {
    privacy.isLocked = true;
    renderView();
    expect(screen.getByText('Desbloquea Flowt para ver tu nómina.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(privacy.openUnlockModal).toHaveBeenCalledOnce();
    expect(screen.queryByText('Última nómina')).not.toBeInTheDocument();
    expect(screen.queryByText(/Cobrada el/)).not.toBeInTheDocument();
  });
  it('shows the empty state without dates', () => {
    renderView([]);
    expect(screen.getByText('Aún no hemos visto ninguna nómina')).toBeInTheDocument();
    expect(screen.queryByText(/Cobrada el/)).not.toBeInTheDocument();
  });
  it('shows salary, comparison, buckets, distribution, remainder, charge and previous period', () => {
    renderView();
    const salary = card('Última nómina');
    expect(salary.getByText('2000,00 €')).toBeInTheDocument();
    expect(salary.getByText('+100,00 € respecto a la anterior')).toBeInTheDocument();
    for (const label of ['Ahorro', 'Suscripciones', 'Libre']) expect(salary.getByText(label)).toBeInTheDocument();
    for (const amount of ['500,00 €', '100,00 €', '1400,00 €']) expect(salary.getByText(amount)).toBeInTheDocument();
    expect(card('Cómo se repartió').getByText('Día a día')).toBeInTheDocument();
    expect(card('Cómo se repartió').getByText('70,0 %')).toBeInTheDocument();
    expect(card('Hasta la próxima nómina').getByText('Te queda')).toBeInTheDocument();
    expect(card('Hasta la próxima nómina').getByText('1200,00 €')).toBeInTheDocument();
    expect(card('Cargos antes de la próxima').getByText('Netflix')).toBeInTheDocument();
    expect(card('Cargos antes de la próxima').getByText('vie 16 oct')).toBeInTheDocument();
    expect(card('El periodo anterior').getByText('Te sobraron')).toBeInTheDocument();
    expect(screen.getByText('Cobrada el 28 de septiembre · la siguiente, hacia el 28 de octubre (en 17 días)')).toBeInTheDocument();
  });
  it('omits comparison and previous period with one payroll and shows no-charge state', () => {
    renderView(movimientos.slice(0, 1), []);
    expect(screen.queryByText(/respecto a la anterior/)).not.toBeInTheDocument();
    expect(screen.queryByText('El periodo anterior')).not.toBeInTheDocument();
    expect(screen.getByText('No hay cargos antes de la próxima nómina')).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });
  it.each([[27, '(mañana)'], [28, '(hoy)']] as const)('describes the next payroll on October %s', (day, label) => {
    vi.setSystemTime(new Date(2026, 9, day, 12));
    renderView();
    expect(screen.getByText(/Cobrada el/).textContent).toContain(label);
  });
});
