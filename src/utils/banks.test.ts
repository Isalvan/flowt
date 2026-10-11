import { describe, expect, it } from 'vitest';
import { BANK_CATALOG, bankInitials, detectedBanks } from './banks';

describe('banks', () => {
  it.each([['Unicaja', 'UN'], ['Trade Republic', 'TR'], ['N26', 'N2'], [' A ', 'A'], ['', '']])('initials of %s', (name, initials) => {
    expect(bankInitials(name)).toBe(initials);
  });
  it('detects distinct names by frequency, ignoring generic and blank names', () => {
    expect(detectedBanks([{ banco: 'Unicaja' }, { banco: 'revolut' }, { banco: 'Revolut' }, { banco: ' Banco ' }, { banco: ' ' }, {}])).toEqual(['revolut', 'Unicaja']);
    expect(BANK_CATALOG).toHaveLength(8);
  });
});
