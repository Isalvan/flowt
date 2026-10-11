import type { Hucha, Movimiento, Suscripcion } from '../types';
import { roundMoney, splitIncome } from './incomeSplit';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { isPayrollMovement } from './payroll';
import { payrollDates, periodOf, previousPeriod } from './periods';
import { parseMovimientoDate } from './periodStats';
import { getCancellationDate, getEffectiveSubscriptionAmount, getSubscriptionChargeForMonth, parseSubscriptionDate } from './subscriptions';

const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;

/** A read-only snapshot of the latest payroll, independent of period preferences. */
export function payrollSummary(movimientos: Movimiento[], huchas: Hucha[], suscripciones: Suscripcion[], now = new Date()) {
  const candidates = movimientos.flatMap(movimiento => {
    const fecha = parseMovimientoDate(movimiento.fecha_operacion);
    return isPayrollMovement(movimiento) && fecha && fecha <= now ? [{ movimiento, fecha }] : [];
  }).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  if (!candidates.length) return null;
  const latest = candidates[0];
  const importe = roundMoney(latest.movimiento.importe);
  const anterior = candidates[1] ? roundMoney(candidates[1].movimiento.importe) : null;
  const nominas = payrollDates(candidates.map(candidate => candidate.movimiento));
  const period = periodOf(now, 'nomina', nominas);
  const dias = Math.max(0, dayNumber(period.end) - dayNumber(now));
  const activeWallets = huchas.filter(hucha => hucha.activa !== false);
  const subscriptionWallets = huchas.filter(hucha => hucha.es_suscripciones);
  const freeWallet = activeWallets.find(hucha => hucha.tipo_aportacion === 'resto')
    ?? activeWallets.find(hucha => hucha.es_principal);
  const repartoRegistrado = latest.movimiento.reparto_aplicado != null;
  const split = latest.movimiento.reparto_aplicado
    ?? (activeWallets.some(hucha => !hucha.es_metalico) ? splitIncome(importe, huchas, { plain: true }) : { saldos: {}, deudas: {} });
  const reparto = Object.entries(split.saldos).map(([huchaId, amount]) => ({
    huchaId, nombre: huchas.find(hucha => hucha.id === huchaId)?.nombre ?? 'Cartera eliminada',
    importe: roundMoney(amount), porcentaje: importe ? roundMoney(amount / importe * 100) : 0,
  })).sort((a, b) => b.importe - a.importe);
  const subscriptions = roundMoney(reparto.reduce((sum, row) => sum + (subscriptionWallets.some(h => h.id === row.huchaId) ? row.importe : 0), 0));
  const libre = freeWallet && !freeWallet.es_suscripciones ? roundMoney(split.saldos[freeWallet.id] ?? 0) : 0;
  // Debt repayments and allocations to deleted wallets also belong to savings.
  const ahorro = roundMoney(importe - subscriptions - libre);
  // Spending charged to another wallet comes out of that wallet's money, not out of the free part.
  const fromAnotherWallet = (movement: Movimiento) => huchas.some(hucha => hucha.id === movement.hucha_id
    && hucha.id !== freeWallet?.id && !hucha.es_principal);
  const gastado = roundMoney(movimientos.reduce((sum, movement) => {
    const fecha = parseMovimientoDate(movement.fecha_operacion);
    return movement.tipo === 'gasto' && cuentaEnEstadisticas(movement) && fecha && fecha >= latest.fecha && fecha <= now
      && !fromAnotherWallet(movement) ? sum + importeEnEstadisticas(movement) : sum;
  }, 0));
  const queda = roundMoney(libre - gastado);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cargos: { sub: Suscripcion; fecha: Date; importe: number }[] = [];
  for (const sub of suscripciones.filter(sub => sub.activa)) {
    const cancellation = getCancellationDate({ ...sub, updated_at: parseSubscriptionDate(sub.updated_at) ?? now });
    for (let month = new Date(today.getFullYear(), today.getMonth(), 1); month <= period.end; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
      const fecha = getSubscriptionChargeForMonth(sub, month.getFullYear(), month.getMonth(), today);
      if (fecha && fecha >= today && fecha <= period.end && (!cancellation || fecha < cancellation)) {
        cargos.push({ sub, fecha, importe: roundMoney(getEffectiveSubscriptionAmount(sub)) });
      }
    }
  }
  cargos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  let periodoAnterior = null;
  if (anterior !== null) {
    const previous = previousPeriod(period, 'nomina', nominas);
    let ingresos = 0;
    let gastos = 0;
    for (const movement of movimientos) {
      const fecha = parseMovimientoDate(movement.fecha_operacion);
      if (!fecha || fecha < previous.start || fecha >= previous.end || !cuentaEnEstadisticas(movement)) continue;
      if (movement.tipo === 'ingreso') ingresos += importeEnEstadisticas(movement);
      else gastos += importeEnEstadisticas(movement);
    }
    periodoAnterior = { period: previous, ingresos: roundMoney(ingresos), gastos: roundMoney(gastos), neto: roundMoney(ingresos - gastos) };
  }
  return {
    nomina: { ...latest, importe }, anterior, diferencia: anterior === null ? null : roundMoney(importe - anterior),
    proxima: { fecha: period.end, dias }, reparto, repartoRegistrado,
    suscripciones: subscriptions, libre, ahorro, gastado, queda,
    porDia: queda > 0 && dias > 0 ? roundMoney(queda / dias) : null,
    cargos, totalCargos: roundMoney(cargos.reduce((sum, cargo) => sum + cargo.importe, 0)), periodoAnterior,
  };
}
