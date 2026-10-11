// @vitest-environment node
/**
 * The income split must give the same result here and in the Python domain.
 * Both test suites read the same cases; a change in either implementation that
 * is not mirrored in the other fails one of them.
 */
import { describe, expect, it } from 'vitest';
import cases from '../../tracker-backend/finance/distribution_cases.json';
import { distributeIncome } from '../src/financeDomain.js';

describe('income split, shared cases', () => {
  it.each(cases.map((entry) => [entry.nombre, entry]))('%s', (_name, entry) => {
    if (entry.error) {
      let code = null;
      try { distributeIncome(entry.importe, entry.huchas, entry.plain, entry.mes); } catch (error) { code = error.code; }
      expect(code).toBe(entry.error);
      return;
    }
    const split = distributeIncome(entry.importe, entry.huchas, entry.plain, entry.mes);
    expect(split).toEqual(entry.esperado);
    expect(Object.values(split.saldos).reduce((total, value) => total + value, 0)).toBe(entry.importe);
  });
});
