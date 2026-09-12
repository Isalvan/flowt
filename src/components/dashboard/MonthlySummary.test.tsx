import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonthlySummary } from './MonthlySummary';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false, formatCurrency: (value: number) => `${value.toFixed(2)} €` }) }));

describe('MonthlySummary', () => {
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
