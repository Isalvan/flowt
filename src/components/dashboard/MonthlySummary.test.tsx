import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthlySummary } from './MonthlySummary';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false, formatCurrency: (value: number) => `${value.toFixed(2)} €` }) }));
const preferences = vi.hoisted(() => ({ inicioPeriodo: 1 }));
vi.mock('../../context/PreferencesContext', () => ({ usePreferences: () => preferences }));
afterEach(() => { cleanup(); preferences.inicioPeriodo = 1; vi.useRealTimers(); });

describe('MonthlySummary', () => {
  it('labels and filters a fixed period including its start and excluding its end', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11));
    preferences.inicioPeriodo = 28;
    render(<MonthlySummary movimientos={[
      { id: 'a', tipo: 'ingreso', concepto: 'A', importe: 100, fecha_operacion: new Date(2026, 8, 28) },
      { id: 'b', tipo: 'gasto', concepto: 'B', importe: 25, fecha_operacion: new Date(2026, 9, 27, 23, 59) },
      { id: 'c', tipo: 'ingreso', concepto: 'C', importe: 900, fecha_operacion: new Date(2026, 8, 27) },
      { id: 'd', tipo: 'gasto', concepto: 'D', importe: 900, fecha_operacion: new Date(2026, 9, 28) },
    ]} />);
    expect(screen.getByText('Resumen del periodo')).toBeInTheDocument();
    expect(screen.getByText('28 sep – 27 oct')).toBeInTheDocument();
    expect(screen.getByText('100.00 €')).toBeInTheDocument();
    expect(screen.getByText('25.00 €')).toBeInTheDocument();
    expect(screen.getByText('75.00 €')).toBeInTheDocument();
  });
  it('accepts Date, string and Firestore Timestamp values', () => {
    const now = new Date();
    const timestamp = { toDate: () => now };
    render(<MonthlySummary movimientos={[{ id: 'a', tipo: 'ingreso', concepto: 'A', importe: 100, fecha_operacion: now }, { id: 'b', tipo: 'gasto', concepto: 'B', importe: 25, fecha_operacion: now.toISOString() }, { id: 'c', tipo: 'ingreso', concepto: 'C', importe: 50, fecha_operacion: timestamp }]} />);
    expect(screen.getByText('150.00 €')).toBeInTheDocument();
    expect(screen.getByText('25.00 €')).toBeInTheDocument();
  });

  it('ignores invalid and absent dates without inventing values', () => {
    render(<MonthlySummary movimientos={[{ id: 'a', tipo: 'ingreso', concepto: 'A', importe: 100, fecha_operacion: 'not-a-date' }, { id: 'b', tipo: 'gasto', concepto: 'B', importe: 25, fecha_operacion: null }]} />);
    expect(screen.getAllByText('0.00 €')).toHaveLength(3);
  });
});
