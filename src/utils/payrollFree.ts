import type { Hucha, Movimiento } from '../types';
import { roundMoney, splitIncome } from './incomeSplit';
import { cuentaEnEstadisticas } from './movements';

/** The wallet that receives the free part of a payroll: the remainder wallet, or else the main one. */
export function freeWalletOf(huchas: readonly Hucha[]): Hucha | undefined {
  const activeWallets = huchas.filter(hucha => hucha.activa !== false);
  return activeWallets.find(hucha => hucha.tipo_aportacion === 'resto')
    ?? activeWallets.find(hucha => hucha.es_principal);
}

/** The split recorded with the payroll, or the one the current rules would give for it. */
export function payrollSplit(payroll: Movimiento, huchas: Hucha[]): Pick<NonNullable<Movimiento['reparto_aplicado']>, 'saldos' | 'deudas'> {
  if (payroll.reparto_aplicado) return payroll.reparto_aplicado;
  const activeWallets = huchas.filter(hucha => hucha.activa !== false);
  return activeWallets.some(hucha => !hucha.es_metalico)
    ? splitIncome(roundMoney(payroll.importe), huchas, { plain: true })
    : { saldos: {}, deudas: {} };
}

/** The free part of a split. A subscriptions wallet is never free money. */
export function freeAmount(split: { saldos: Record<string, number> }, freeWallet: Hucha | undefined): number {
  return freeWallet && !freeWallet.es_suscripciones ? roundMoney(split.saldos[freeWallet.id] ?? 0) : 0;
}

/** The free part of one payroll, with the recorded split or the current rules. */
export function payrollLibre(payroll: Movimiento, huchas: Hucha[]): number {
  return freeAmount(payrollSplit(payroll, huchas), freeWalletOf(huchas));
}

/**
 * Whether an expense comes out of the free part. Spending charged to another
 * wallet comes out of that wallet's money, not out of the free part.
 */
export function isFreeSpending(movement: Movimiento, huchas: readonly Hucha[], freeWallet = freeWalletOf(huchas)): boolean {
  if (movement.tipo !== 'gasto' || !cuentaEnEstadisticas(movement)) return false;
  return !huchas.some(hucha => hucha.id === movement.hucha_id && hucha.id !== freeWallet?.id && !hucha.es_principal);
}
