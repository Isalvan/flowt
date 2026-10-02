import catalog from '../../tracker-backend/prompts/categories.json';
import type { Movimiento } from '../types';

export const MOVEMENT_CATEGORIES = catalog;
export const categoryOptions = (tipo: Movimiento['tipo']) =>
  catalog.filter(c => c.tipo === tipo || c.tipo === 'ambos');
export const validCategory = (id: string, tipo: Movimiento['tipo']) =>
  categoryOptions(tipo).some(c => c.id === id);
export const categoryLabel = (id?: string) =>
  catalog.find(c => c.id === id)?.label ?? 'Sin categorizar';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const expenseRules: [RegExp, string][] = [
  [/\b(mercadona|lidl|aldi|carrefour|supermercado|super|alimentacion|bm)\b/, 'alimentacion'],
  [/\b(restaurante|restaurantes|shawarma|pizza|pizzeria|burger|cafeteria|cena)\b/, 'restaurantes'],
  [/\b(spotify|netflix|cine|playstation|steam|youtube|ocio)\b/, 'ocio'],
  [/\b(pccomponentes|google one|icloud|chatgpt|hosting|software)\b/, 'tecnologia'],
  [/\b(repsol|cepsa|gasolina|gasolinera|renfe|uber|cabify|autobus|taxi)\b/, 'transporte'],
  [/\b(farmacia|dentista|medico|clinica|gimnasio)\b/, 'salud'],
  [/\b(alquiler|hipoteca|iberdrola|endesa|electricidad|agua|internet)\b/, 'vivienda'],
  [/\b(curso|formacion|universidad|matricula)\b/, 'formacion'],
  [/\b(amazon|amaz|compras|ropa|zara)\b/, 'compras'],
  [/\b(trade republic|inversion)\b/, 'inversion'],
];
const incomeRules: [RegExp, string][] = [
  [/\b(nomina|salario|sueldo)\b/, 'nomina'],
  [/\b(reembolso|devolucion|compensacion)\b/, 'reembolsos'],
  [/\b(venta|wallapop|vinted)\b/, 'ventas'],
  [/\b(intereses|dividendos)\b/, 'intereses'],
  [/\b(regalo|cumpleanos)\b/, 'regalos'],
  [/\b(freelance|honorarios|trabajo extra)\b/, 'trabajos'],
];

export interface CategorySuggestion {
  categoria: string;
  confianza: 'alta' | 'media' | 'baja';
  motivo: string;
}

export function suggestCategory(m: Movimiento): CategorySuggestion | null {
  if (m.es_interno || m.transfer_id || (m.categoria && validCategory(m.categoria, m.tipo))) return null;
  if (m.categoria_sugerida && m.categoria_sugerida !== 'sin_categorizar' && validCategory(m.categoria_sugerida, m.tipo)) {
    return { categoria: m.categoria_sugerida, confianza: m.categoria_confianza ?? 'baja', motivo: 'Propuesta a partir del aviso bancario' };
  }
  const text = normalize(m.concepto);
  const rule = (m.tipo === 'gasto' ? expenseRules : incomeRules).find(([pattern]) => pattern.test(text));
  if (rule) return { categoria: rule[1], confianza: text.includes('bizum') || rule[1] === 'compras' ? 'media' : 'alta', motivo: 'Comercio o concepto reconocido' };
  // «Comida» no permite distinguir un supermercado de un restaurante.
  return { categoria: m.tipo === 'gasto' ? 'otros_gastos' : 'otros_ingresos', confianza: 'baja', motivo: 'El concepto no permite saber el motivo; revisa la categoría' };
}

export const availableAmount = (m: Movimiento): number => {
  if (!Number.isFinite(m.importe) || m.importe < 0) return 0;
  if (m.tipo === 'gasto') return Math.max(0, Math.round((m.importe_neto ?? (m.importe - (m.compensado_por_detalles ?? []).reduce((s, d) => s + d.importe, 0))) * 100) / 100);
  if (m.compensa_movimiento_id) return 0; // Los enlaces antiguos ya consumían el ingreso completo.
  return Math.max(0, Math.round((m.importe - (m.compensaciones_destinos ?? []).reduce((s, d) => s + d.importe, 0)) * 100) / 100);
};

export function movementDate(m: Movimiento): Date | null {
  const value = m.fecha_operacion;
  const date = value?.toDate instanceof Function ? value.toDate() : value instanceof Date ? value : new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date : null;
}
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
const calendarDay = (m: Movimiento) => {
  const date = movementDate(m);
  return date ? dayFormatter.format(date) : null;
};

export interface CompensationSuggestion {
  id: string;
  ingreso: Movimiento;
  gasto: Movimiento;
  importe: number;
  confianza: 'media' | 'baja';
  motivo: string;
  score: number;
}

export function suggestCompensations(movements: Movimiento[]): CompensationSuggestion[] {
  const eligible = movements.filter(m => !m.es_interno && !m.transfer_id && availableAmount(m) > 0);
  const expenses = eligible.filter(m => m.tipo === 'gasto');
  const suggestions: CompensationSuggestion[] = [];
  for (const ingreso of eligible.filter(m => m.tipo === 'ingreso')) {
    if (['nomina', 'trabajos', 'ventas', 'intereses', 'regalos'].includes(ingreso.categoria ?? '') || /\b(nomina|salario|sueldo|intereses|dividendos)\b/.test(normalize(ingreso.concepto))) continue;
    const day = calendarDay(ingreso);
    if (!day) continue;
    const amount = availableAmount(ingreso);
    const candidates: CompensationSuggestion[] = [];
    for (const gasto of expenses) {
      if (calendarDay(gasto) !== day || ingreso.compensaciones_descartadas?.includes(gasto.id) || gasto.compensaciones_descartadas?.includes(ingreso.id)) continue;
      if (ingreso.compensaciones_destinos?.some(d => d.gasto_id === gasto.id) || gasto.compensado_por?.includes(ingreso.id) || gasto.compensado_por_detalles?.some(d => d.ingreso_id === ingreso.id)) continue;
      const available = availableAmount(gasto);
      if (amount > available) continue;
      const tolerance = Math.min(1, Math.max(0.05, available * 0.02));
      const fractions = [1, 1 / 2, 1 / 3, 1 / 4, 2 / 3, 3 / 4];
      const fraction = fractions.find(f => Math.abs(amount - available * f) <= tolerance);
      const refundClue = /\b(reembolso|devolucion|compensacion|mi parte|tu parte)\b/.test(normalize(ingreso.concepto));
      if (!fraction && !refundClue) continue;
      const hours = Math.abs(movementDate(ingreso)!.getTime() - movementDate(gasto)!.getTime()) / 3_600_000;
      const exact = Math.abs(amount - available) < 0.01;
      const share = fraction === 1 / 2 ? 'aproximadamente la mitad del gasto' : fraction ? `aproximadamente el ${Math.round(fraction * 100)} % del gasto` : 'un importe parcial compatible';
      candidates.push({
        id: `${ingreso.id}:${gasto.id}`, ingreso, gasto, importe: amount,
        confianza: exact || refundClue ? 'media' : 'baja',
        motivo: `Mismo día · ${exact ? 'mismo importe disponible' : share}. Puede ser un reembolso.`,
        score: (exact ? 100 : fraction ? 60 : 30) + (refundClue ? 15 : 0) - Math.min(hours, 24),
      });
    }
    candidates.sort((a, b) => b.score - a.score || a.gasto.id.localeCompare(b.gasto.id));
    if (candidates[0]) {
      if (candidates[1] && candidates[0].score - candidates[1].score < 10) {
        candidates[0].confianza = 'baja';
        candidates[0].motivo += ' Hay varios gastos compatibles; comprueba la pareja.';
      }
      suggestions.push(candidates[0]);
    }
  }
  return suggestions.sort((a, b) => (movementDate(b.ingreso)?.getTime() ?? 0) - (movementDate(a.ingreso)?.getTime() ?? 0));
}

/** Validación sobre documentos actuales; se utiliza dentro de la transacción. */
export function compensationUpdates(base: Movimiento, allocations: { mov: Movimiento; importe: number }[]): Map<string, Partial<Movimiento>> {
  if (!allocations.length || base.es_interno || base.transfer_id) throw new Error('Selecciona movimientos externos para compensar.');
  const ids = new Set<string>();
  let total = 0;
  for (const a of allocations) {
    if (ids.has(a.mov.id) || a.mov.id === base.id || a.mov.tipo === base.tipo || a.mov.es_interno || a.mov.transfer_id) throw new Error('La compensación necesita un gasto y un ingreso distintos.');
    ids.add(a.mov.id);
    if (!Number.isFinite(a.importe) || a.importe <= 0 || Math.abs(a.importe * 100 - Math.round(a.importe * 100)) > 0.00001 || a.importe > availableAmount(a.mov) + 0.00001) throw new Error('El importe supera el saldo disponible o no es válido.');
    total += Math.round(a.importe * 100);
  }
  if (total > Math.round(availableAmount(base) * 100)) throw new Error('El importe supera el saldo disponible del movimiento.');
  const current = new Map<string, Movimiento>([[base.id, { ...base }], ...allocations.map(a => [a.mov.id, { ...a.mov }] as [string, Movimiento])]);
  const updates = new Map<string, Partial<Movimiento>>();
  for (const a of allocations) {
    const gasto = current.get(base.tipo === 'gasto' ? base.id : a.mov.id)!;
    const ingreso = current.get(base.tipo === 'ingreso' ? base.id : a.mov.id)!;
    const detalles = [...(gasto.compensado_por_detalles ?? [])].filter(d => d.ingreso_id !== ingreso.id);
    const previo = gasto.compensado_por_detalles?.find(d => d.ingreso_id === ingreso.id)?.importe ?? 0;
    detalles.push({ ingreso_id: ingreso.id, importe: Math.round((previo + a.importe) * 100) / 100 });
    const destinos = [...(ingreso.compensaciones_destinos ?? [])].filter(d => d.gasto_id !== gasto.id);
    const previoIngreso = ingreso.compensaciones_destinos?.find(d => d.gasto_id === gasto.id)?.importe ?? 0;
    destinos.push({ gasto_id: gasto.id, importe: Math.round((previoIngreso + a.importe) * 100) / 100 });
    const gastoUpdate = { compensado_por_detalles: detalles, importe_neto: Math.round((availableAmount(gasto) - a.importe) * 100) / 100 };
    const ingresoUpdate = { compensaciones_destinos: destinos };
    current.set(gasto.id, { ...gasto, ...gastoUpdate });
    current.set(ingreso.id, { ...ingreso, ...ingresoUpdate });
    updates.set(gasto.id, gastoUpdate);
    updates.set(ingreso.id, ingresoUpdate);
  }
  return updates;
}

/** Devuelve ambos lados al estado anterior sin perder otros reembolsos. */
export function unlinkCompensationUpdates(base: Movimiento, related: Movimiento[]): Map<string, Partial<Movimiento>> {
  const updates = new Map<string, Partial<Movimiento>>();
  let currentBase = { ...base };
  for (const target of related) {
    if (target.tipo === base.tipo) continue;
    const gasto = base.tipo === 'gasto' ? currentBase : target;
    const ingreso = base.tipo === 'ingreso' ? currentBase : target;
    const detalle = gasto.compensado_por_detalles?.find(d => d.ingreso_id === ingreso.id);
    const destino = ingreso.compensaciones_destinos?.find(d => d.gasto_id === gasto.id);
    const legacy = gasto.compensado_por?.includes(ingreso.id) || ingreso.compensa_movimiento_id === gasto.id;
    if (!detalle && !destino && !legacy) continue;
    const amount = detalle?.importe ?? destino?.importe ?? ingreso.importe;
    const detalles = gasto.compensado_por_detalles?.filter(d => d.ingreso_id !== ingreso.id);
    const legacyIds = gasto.compensado_por?.filter(id => id !== ingreso.id);
    const destinos = ingreso.compensaciones_destinos?.filter(d => d.gasto_id !== gasto.id);
    const gastoUpdate: Partial<Movimiento> = {
      compensado_por_detalles: detalles?.length ? detalles : undefined,
      compensado_por: legacyIds?.length ? legacyIds : undefined,
      importe_neto: detalles?.length || legacyIds?.length ? Math.min(gasto.importe, Math.round((availableAmount(gasto) + amount) * 100) / 100) : undefined,
    };
    const ingresoUpdate: Partial<Movimiento> = {
      compensaciones_destinos: destinos?.length ? destinos : undefined,
      compensa_movimiento_id: ingreso.compensa_movimiento_id === gasto.id ? undefined : ingreso.compensa_movimiento_id,
    };
    updates.set(gasto.id, gastoUpdate);
    updates.set(ingreso.id, ingresoUpdate);
    currentBase = { ...currentBase, ...(base.tipo === 'gasto' ? gastoUpdate : ingresoUpdate) };
  }
  return updates;
}
