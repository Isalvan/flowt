import type { Hucha, Movimiento, Suscripcion } from '../types';
import { parseMovimientoDate } from './periodStats';
import { toUtcCalendarDay } from './financialDates';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { isSubscriptionMovement } from './serviceNames';
import { getCancellationDate, getEffectiveSubscriptionAmount, getSubscriptionChargeForMonth, parseSubscriptionDate } from './subscriptions';
import { detectPayroll, isPayrollMovement } from './payroll';
import { isIncomeSplitError, roundMoney, splitIncome } from './incomeSplit';

export interface WalletForecast {
  previsto: number;
  gastoVariable: number;
  suscripciones: number;
  ingresos: number;
  diasRestantes: number;
  sinHistorial: boolean;
}

/** Previsión por días naturales, desde mañana hasta el cierre del mes actual. */
export function forecastMonthEnd(
  huchas: Hucha[],
  movimientos: Movimiento[],
  suscripciones: Suscripcion[],
  now = new Date(),
): Record<string, WalletForecast> {
  const activas = huchas.filter(h => h.activa !== false);
  if (!activas.length) return {};
  const porDefecto = activas.find(h => h.es_principal)
    ?? activas.find(h => h.tipo_aportacion === 'resto') ?? activas[0];
  const carteraSuscripciones = activas.find(h => h.es_suscripciones);
  const idsActivos = new Set(activas.map(h => h.id));
  const idsSuscripciones = new Set(huchas.filter(h => h.es_suscripciones).map(h => h.id));
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = toUtcCalendarDay(now);
  const finMes = toUtcCalendarDay(new Date(year, month + 1, 0));
  const diaMs = 86_400_000;
  const diasRestantes = (finMes - today) / diaMs;
  const fechados = movimientos.flatMap(movimiento => {
    const fecha = parseMovimientoDate(movimiento.fecha_operacion);
    if (!fecha) return [];
    const dia = toUtcCalendarDay(fecha);
    return dia <= today ? [{ movimiento, dia }] : [];
  });
  const primerDia = fechados.reduce((first, { dia }) => Math.min(first, dia), today);
  const inicioVentana = Math.max(primerDia, today - 89 * diaMs);
  const diasVentana = (today - inicioVentana) / diaMs + 1;
  const sinHistorial = diasVentana < 14;
  const forecast: Record<string, WalletForecast> = Object.fromEntries(activas.map(h => [h.id, {
    previsto: h.saldo_acumulado, gastoVariable: 0, suscripciones: 0, ingresos: 0,
    diasRestantes, sinHistorial,
  }]));
  const gastos: Record<string, number> = {};
  const nombresDeSuscripciones = suscripciones.map(s => s.nombre);
  if (!sinHistorial && diasRestantes > 0) {
    for (const { movimiento: m, dia } of fechados) {
      if (dia < inicioVentana || m.tipo !== 'gasto' || !cuentaEnEstadisticas(m)
        || m.suscripcion_id || idsSuscripciones.has(m.hucha_id ?? '')
        || isSubscriptionMovement(m.concepto, nombresDeSuscripciones)) continue;
      const id = m.hucha_id && idsActivos.has(m.hucha_id) ? m.hucha_id : porDefecto.id;
      gastos[id] = (gastos[id] ?? 0) + Math.abs(importeEnEstadisticas(m));
    }
  }

  for (const s of suscripciones) {
    if (!s.activa) continue;
    const cobro = getSubscriptionChargeForMonth(s, year, month, now);
    if (!cobro || toUtcCalendarDay(cobro) <= today || toUtcCalendarDay(cobro) > finMes) continue;
    // La utilidad de bajas necesita una fecha de referencia para registros antiguos.
    const baja = getCancellationDate({ ...s, updated_at: parseSubscriptionDate(s.updated_at) ?? now });
    if (baja && cobro >= baja) continue;
    const id = s.hucha_id && idsActivos.has(s.hucha_id)
      ? s.hucha_id : (carteraSuscripciones ?? porDefecto).id;
    forecast[id].suscripciones += getEffectiveSubscriptionAmount(s);
  }

  const payroll = detectPayroll(movimientos, now);
  const yaCobrada = fechados.some(({ movimiento, dia }) =>
    dia >= toUtcCalendarDay(new Date(year, month, 1)) && isPayrollMovement(movimiento));
  if (payroll && !yaCobrada) {
    const diaNomina = Math.min(new Date(year, month + 1, 0).getDate(), Math.max(1, Math.round(payroll.diaHabitual)));
    if (diaNomina > now.getDate()) {
      try {
        const split = splitIncome(payroll.importe, activas, { extraMonth: `${year}-${String(month + 1).padStart(2, '0')}` });
        for (const h of activas) forecast[h.id].ingresos = split.saldos[h.id] ?? 0;
      } catch (error) {
        if (!isIncomeSplitError(error)) throw error;
      }
    }
  }

  for (const h of activas) {
    const f = forecast[h.id];
    f.gastoVariable = roundMoney(((gastos[h.id] ?? 0) / diasVentana) * diasRestantes);
    f.suscripciones = roundMoney(f.suscripciones);
    f.previsto = roundMoney(h.saldo_acumulado + f.ingresos - f.gastoVariable - f.suscripciones);
  }
  return forecast;
}
