import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { ActivityList } from './ActivityList';

const state = vi.hoisted(() => ({ locked: false, horas: 40 as number | null }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: state.locked, formatCurrency: (n: number) => `${n} €` }) }));
vi.mock('../../context/PreferencesContext', () => ({ usePreferences: () => ({ horasSemanales: state.horas, umbralCompraPequena: 5, updatePreferences: vi.fn() }) }));

// 1.733,33 € al mes con 40 h semanales son 10 € la hora.
const movements: Movimiento[] = [
  { id: 'nomina', tipo: 'ingreso', concepto: 'Nómina', categoria: 'nomina', importe: 1733.33, fecha_operacion: '2026-09-28T09:00:00+02:00' },
  { id: 'cena', tipo: 'gasto', concepto: 'Cena', importe: 45, fecha_operacion: '2026-10-10T21:00:00+02:00' },
  { id: 'cafe', tipo: 'gasto', concepto: 'Café', importe: 2, fecha_operacion: '2026-10-10T10:00:00+02:00' },
];
const setup = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T20:00:00Z'));
  render(<ActivityList movimientos={movements} allMovimientos={movements} huchas={[]} huchaMonthlyBudgets={{}} onUpdateConcepto={vi.fn()} onConvert={vi.fn()} onLink={vi.fn()} onUnlink={vi.fn()} onChangeHucha={vi.fn()} onDeleteMovimiento={vi.fn()} />);
};
afterEach(() => { vi.useRealTimers(); state.locked = false; state.horas = 40; });

describe('precio en horas de trabajo', () => {
  it('lo muestra en los gastos que suponen media hora o más', () => {
    setup();
    expect(screen.getByText('4 h 30 min de trabajo')).toBeInTheDocument();
    expect(screen.getAllByText(/de trabajo/)).toHaveLength(1);
  });

  it('no aparece sin horas configuradas', () => {
    state.horas = null;
    setup();
    expect(screen.queryByText(/de trabajo/)).not.toBeInTheDocument();
  });

  it('no aparece con la app bloqueada', () => {
    state.locked = true;
    setup();
    expect(screen.queryByText(/de trabajo/)).not.toBeInTheDocument();
  });
});
