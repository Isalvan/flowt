/**
 * Helper to sanitize CSV cells against CSV Formula Injection (Excel / LibreOffice / Google Sheets)
 * and properly format cells according to RFC 4180 CSV standard.
 */

const DANGEROUS_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r', '\n', '|'];

export function escapeCsvCell(value: any): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let strVal = String(value);

  // Check if raw string or trimmed string begins with a formula trigger character
  const trimmed = strVal.trimStart();
  const startsWithFormula = DANGEROUS_FORMULA_PREFIXES.some(
    prefix => strVal.startsWith(prefix) || (trimmed.length > 0 && trimmed.startsWith(prefix))
  );

  if (startsWithFormula) {
    strVal = `'${strVal}`;
  }

  // Escape internal double quotes by doubling them
  const escapedQuotes = strVal.replace(/"/g, '""');

  // Enclose in double quotes
  return `"${escapedQuotes}"`;
}

export function generateCsv(headers: string[], rows: any[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map(row => row.map(escapeCsvCell).join(','));
  return [headerLine, ...rowLines].join('\n');
}
