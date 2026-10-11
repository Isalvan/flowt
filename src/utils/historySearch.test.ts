import { describe, expect, it } from 'vitest';
import { matchesHistoryMovement } from './historySearch';
import type { Movimiento } from '../types';

const movement: Movimiento = { id: '1', concepto: 'Nómina de septiembre', tipo: 'ingreso', importe: 12.50, fecha_operacion: '2026-09-01' };

describe('history matching', () => {
  it('ignores accents, case and surrounding whitespace in concepts', () => {
    expect(matchesHistoryMovement(movement, '  NOMINA  ', 'all')).toBe(true);
    expect(matchesHistoryMovement(movement, 'septiembre', 'ingreso')).toBe(true);
    expect(matchesHistoryMovement(movement, 'nomina', 'gasto')).toBe(false);
  });
  it('accepts comma and dot decimal separators and partial amounts', () => {
    for (const term of ['12,5', '12.5', '12']) expect(matchesHistoryMovement(movement, term, 'all')).toBe(true);
    expect(matchesHistoryMovement(movement, '13,5', 'all')).toBe(false);
  });
  it('preserves the type filter even with an empty search', () => {
    expect(matchesHistoryMovement(movement, ' ', 'all')).toBe(true);
    expect(matchesHistoryMovement(movement, '', 'gasto')).toBe(false);
  });
});
