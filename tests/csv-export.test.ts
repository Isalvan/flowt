import { describe, it, expect } from 'vitest';
import { escapeCsvCell, generateCsv } from '../src/utils/csv';

describe('CSV Formula Injection Prevention & Formatting', () => {
  it('handles null, undefined and empty values safely', () => {
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
    expect(escapeCsvCell('')).toBe('""');
  });

  it('formats normal strings, numbers and booleans', () => {
    expect(escapeCsvCell('Mercadona')).toBe('"Mercadona"');
    expect(escapeCsvCell(125.50)).toBe('"125.5"');
    expect(escapeCsvCell(true)).toBe('"true"');
  });

  it('escapes internal double quotes by doubling them', () => {
    expect(escapeCsvCell('Compra "Online"')).toBe('"Compra ""Online"""');
  });

  it('neutralizes dangerous formula prefixes (=, +, -, @, \\t, \\r, \\n, |)', () => {
    expect(escapeCsvCell('=1+2')).toBe(`"'=1+2"`);
    expect(escapeCsvCell('+12345')).toBe(`"'+12345"`);
    expect(escapeCsvCell('-100.0')).toBe(`"'-100.0"`);
    expect(escapeCsvCell('@SUM(A1:A10)')).toBe(`"'@SUM(A1:A10)"`);
    expect(escapeCsvCell('\tTabbed string')).toBe(`"'\tTabbed string"`);
    expect(escapeCsvCell('|DDE_CMD')).toBe(`"'|DDE_CMD"`);
  });

  it('neutralizes formula prefixes even when preceded by whitespace', () => {
    expect(escapeCsvCell('   =SUM(A1:A10)')).toBe(`"'   =SUM(A1:A10)"`);
    expect(escapeCsvCell('  +49123456')).toBe(`"'  +49123456"`);
  });

  it('preserves Spanish accents, special characters and emojis', () => {
    expect(escapeCsvCell('Nómina y Alimentación')).toBe('"Nómina y Alimentación"');
    expect(escapeCsvCell('Café ☕')).toBe('"Café ☕"');
  });

  it('generates a complete valid RFC 4180 CSV string', () => {
    const headers = ['ID', 'Concepto', 'Importe'];
    const rows = [
      ['m-1', 'Nómina Abril', 2450.0],
      ['m-2', '=CMD|"/C calc"!A0', 50.0],
      ['m-3', 'Compra "Súper"', 84.5],
    ];

    const result = generateCsv(headers, rows);
    const lines = result.split('\n');

    expect(lines[0]).toBe('"ID","Concepto","Importe"');
    expect(lines[1]).toBe('"m-1","Nómina Abril","2450"');
    expect(lines[2]).toBe(`"m-2","'=CMD|""/C calc""!A0","50"`);
    expect(lines[3]).toBe('"m-3","Compra ""Súper""","84.5"');
  });
});
