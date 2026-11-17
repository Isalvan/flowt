/** Validate untrusted model output. No image data or persistence belongs here. */
import categories from '../../tracker-backend/prompts/categories.json';
import { FlowtError } from './errors.js';

export const NOT_A_TICKET = 'No he podido leer el ticket. Prueba con más luz y el ticket entero.';
const expenses = new Set(categories.filter((c) => ['gasto', 'ambos'].includes(c.tipo)).map((c) => c.id));
const fail = () => { throw new FlowtError('not_a_ticket', NOT_A_TICKET); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const label = (value) => typeof value === 'string' ? [...value.trim()].slice(0, 120).join('') : '';

function number(value) {
  if (typeof value === 'string' && /^-?\d+(?:[.,]\d+)?$/.test(value.trim())) value = Number(value.trim().replace(',', '.'));
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) fail();
  return value;
}

// Half away from zero, including discount lines. Sum rounded integer cents.
const cents = (value) => Math.sign(value) * Math.floor(Math.abs(value) * 100 + 0.5 + 1e-8);

export function sanitizeTicket(raw, today) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { fail(); }
  }
  if (!object(raw) || raw.es_ticket === false || !label(raw.comercio)
      || !Array.isArray(raw.lineas) || !raw.lineas.length || raw.lineas.length > 150) fail();
  const amount = number(raw.total);
  const total = cents(amount);
  if (amount <= 0 || amount > 10000 || total <= 0) fail();
  const lineas = raw.lineas.map((line) => {
    if (!object(line) || !label(line.descripcion)) fail();
    const cantidad = number(line.cantidad ?? 1);
    if (cantidad <= 0) fail();
    return { descripcion: label(line.descripcion), cantidad, importe: cents(number(line.importe)) / 100 };
  });
  let fecha = null;
  if (typeof raw.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.fecha) && raw.fecha >= '0001-01-01') {
    const parsed = new Date(`${raw.fecha}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw.fecha && raw.fecha <= today) fecha = raw.fecha;
  }
  const moneda = typeof raw.moneda === 'string' ? raw.moneda.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(moneda)) fail();
  const difference = total - lineas.reduce((sum, line) => sum + cents(line.importe), 0);
  return { comercio: label(raw.comercio), fecha, total: total / 100, moneda,
    categoria_sugerida: expenses.has(raw.categoria_sugerida) ? raw.categoria_sugerida : 'sin_categorizar',
    lineas, cuadra: Math.abs(difference) <= 5, diferencia: difference / 100 };
}
