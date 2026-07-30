/**
 * Sanitiza y trunca cadenas de concepto para evitar desbordamientos de buffer,
 * caracteres de control o inyecciones de texto en Firestore/UI.
 */
export function sanitizeConcepto(input: string, maxLength: number = 200): string {
  if (!input) return '';
  // Eliminar caracteres de control ASCII/Unicode no imprimibles
  const cleaned = input.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
  return cleaned.slice(0, maxLength);
}
