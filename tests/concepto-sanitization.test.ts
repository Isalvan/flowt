import { describe, it, expect } from 'vitest';
import { sanitizeConcepto } from '../src/utils/sanitize';

describe('Concept Sanitization & Validation', () => {
  it('truncates concept strings longer than max length', () => {
    const longConcept = 'A'.repeat(300);
    const sanitized = sanitizeConcepto(longConcept, 200);
    expect(sanitized).toHaveLength(200);
  });

  it('strips non-printable ASCII control characters', () => {
    const controlConcept = 'Compra\x00 en\x07 Mercadona\x1F';
    const sanitized = sanitizeConcepto(controlConcept, 200);
    expect(sanitized).toBe('Compra en Mercadona');
  });

  it('returns empty string for null or empty input', () => {
    expect(sanitizeConcepto('')).toBe('');
    expect(sanitizeConcepto('   ')).toBe('');
  });
});
