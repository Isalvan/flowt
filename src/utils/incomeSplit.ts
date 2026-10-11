import { cents, euros, percentOf, room, fallbackHucha, distributeIncome, incomeReversal, recordedSplit as domainRecordedSplit } from '../../mcp-worker/src/financeDomain.js';
import type { Hucha, Movimiento } from '../types';

export type IncomeSplit = NonNullable<Movimiento['reparto_aplicado']>;
export type IncomeRow = { huchaId: string; tipoAportacion: Hucha['tipo_aportacion']; value: number };

export const roundMoney = (value: number): number => euros(cents(value));
const walletsById = (huchas: Hucha[]) => Object.fromEntries(huchas.map(h => [h.id, h]));

/** All public splits use euros. Positive debt amounts repay; negative ones restore. */
export function splitIncome(importe: number, huchas: Hucha[], options?: { plain?: boolean }): IncomeSplit {
  return domainRecordedSplit(distributeIncome(cents(importe), walletsById(huchas), options?.plain));
}

export function reverseIncome(movimiento: Movimiento, huchas: Hucha[]): IncomeSplit {
  // Directed incomes never used automatic rules. Feed their recorded credit to the domain too.
  const movement = movimiento.hucha_id && !movimiento.reparto_aplicado
    ? { ...movimiento, reparto_aplicado: { saldos: { [movimiento.hucha_id]: movimiento.importe }, deudas: {} } }
    : movimiento;
  const split = domainRecordedSplit(incomeReversal(movement, walletsById(huchas)));
  return { ...split, deudas: Object.fromEntries(Object.entries(split.deudas).map(([id, debt]) => [id, { ...debt, importe: -debt.importe }])) };
}

export function applySplit(huchas: Hucha[], split: IncomeSplit): Hucha[] {
  return huchas.map(h => {
    const debt = split.deudas[h.id];
    const owed = debt ? Math.max(0, cents(h.deuda_pendiente || 0) - cents(debt.importe)) : 0;
    return {
      ...h,
      saldo_acumulado: euros(cents(h.saldo_acumulado || 0) + cents(split.saldos[h.id] || 0)),
      ...(debt ? { deuda_pendiente: euros(owed), deuda_con: owed > 0 ? debt.con : null } : {}),
    };
  });
}

export function recordedSplit(split: IncomeSplit): IncomeSplit {
  return domainRecordedSplit({
    saldos: Object.fromEntries(Object.entries(split.saldos).map(([id, value]) => [id, cents(value)])),
    deudas: Object.fromEntries(Object.entries(split.deudas).map(([id, debt]) => [id, { ...debt, importe: cents(debt.importe) }])),
  });
}

export const isIncomeSplitError = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && 'code' in error && ['no_hucha', 'invalid_distribution'].includes(String(error.code));

/** A directed transfer/refund keeps its existing cap policy; it is not an income split. */
export function cappedWalletCredit(huchaId: string | undefined, importe: number, huchas: Hucha[]) {
  const wallet = huchas.find(h => h.id === huchaId);
  if (!wallet) return { adjusted: {}, overflow: 0, restoId: null };
  const amount = cents(importe);
  const accepted = Math.min(amount, room(wallet) ?? amount);
  const adjusted: Record<string, number> = { [wallet.id]: euros(accepted) };
  let overflow = amount - accepted;
  const restoId = overflow ? fallbackHucha(walletsById(huchas)) : null;
  const rest = huchas.find(h => h.id === restoId);
  if (rest) {
    const redirected = Math.min(overflow, room(rest, cents(adjusted[rest.id] || 0)) ?? overflow);
    adjusted[rest.id] = euros(cents(adjusted[rest.id] || 0) + redirected);
    overflow -= redirected;
  }
  return { adjusted, overflow: euros(overflow), restoId };
}

/** Explicit user amounts bypass caps and debts, but must account for every cent. */
export function explicitIncomeShares(importe: number, huchas: Hucha[], rows: IncomeRow[]): number[] {
  const invalid = () => { throw Object.assign(new Error('El reparto debe sumar exactamente el importe del movimiento'), { code: 'invalid_distribution' }); };
  const amount = cents(importe);
  if (rows.some(row => !Number.isFinite(row.value) || row.value < 0)) invalid();
  const shares = rows.map(row => row.tipoAportacion === 'resto' ? 0
    : row.tipoAportacion === 'flat' ? cents(row.value) : percentOf(amount, row.value));
  const remainder = amount - shares.reduce((sum, value) => sum + value, 0);
  const values = rows.map((row, index) => {
    if (!huchas.some(h => h.id === row.huchaId && h.activa !== false)) invalid();
    const share = row.tipoAportacion === 'resto' ? remainder : shares[index];
    if (share < 0) invalid();
    return share;
  });
  if (values.reduce((sum, value) => sum + value, 0) !== amount) invalid();
  return values.map(euros);
}

export function explicitIncomeSplit(importe: number, huchas: Hucha[], rows: IncomeRow[]): IncomeSplit {
  const shares = explicitIncomeShares(importe, huchas, rows);
  const saldos: Record<string, number> = {};
  rows.forEach((row, index) => { saldos[row.huchaId] = (saldos[row.huchaId] || 0) + cents(shares[index]); });
  return domainRecordedSplit({ saldos, deudas: {} });
}
