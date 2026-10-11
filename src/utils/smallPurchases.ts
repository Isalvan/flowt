import type { Movimiento } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { normalizeServiceName } from './serviceNames';

export interface SmallPurchaseMerchant {
  nombre: string;
  count: number;
  total: number;
}

export interface SmallPurchasesSummary {
  count: number;
  total: number;
  porComercio: SmallPurchaseMerchant[];
}

/**
 * Agrupa y resume los gastos de poco importe del periodo.
 * Excluye ingresos, transferencias/movimientos internos y suscripciones.
 * Usa el importe neto en estadísticas y un umbral estricto (< umbral).
 */
export function summarizeSmallPurchases(
  movimientos: readonly Movimiento[],
  umbral: number,
): SmallPurchasesSummary {
  if (umbral <= 0) {
    return { count: 0, total: 0, porComercio: [] };
  }

  // Grouped by normalised name, shown with the concept as the user sees it in the list.
  const merchantsMap = new Map<string, { nombre: string; count: number; totalCents: number }>();
  let totalCents = 0;
  let count = 0;

  for (const m of movimientos) {
    if (m.tipo !== 'gasto') continue;
    if (!cuentaEnEstadisticas(m)) continue;
    if (m.suscripcion_id) continue;

    const importe = importeEnEstadisticas(m);
    if (importe <= 0 || importe >= umbral) continue;

    const cents = Math.round(importe * 100);
    totalCents += cents;
    count += 1;

    const concepto = m.concepto?.trim() ?? '';
    const key = normalizeServiceName(concepto) || concepto || 'otros';
    const existing = merchantsMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalCents += cents;
    } else {
      merchantsMap.set(key, { nombre: concepto || 'Otros', count: 1, totalCents: cents });
    }
  }

  const porComercio: SmallPurchaseMerchant[] = Array.from(merchantsMap.entries())
    .map(([, data]) => ({
      nombre: data.nombre,
      count: data.count,
      total: Math.round(data.totalCents) / 100,
    }))
    .sort((a, b) => b.total - a.total || b.count - a.count || a.nombre.localeCompare(b.nombre));

  return {
    count,
    total: Math.round(totalCents) / 100,
    porComercio,
  };
}
