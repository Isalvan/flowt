/**
 * Pure wallet arithmetic for the finance tools. All money is integer cents.
 *
 * Nothing here reads or writes Firestore: callers read every input inside their
 * transaction and persist the returned plan as a whole.
 */
import { fail } from './errors.js';

export const FREQUENCY_MONTHS = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };
export const SUBSCRIPTION_CATEGORIES = ['streaming', 'musica', 'software', 'gaming', 'fitness', 'noticias', 'otros'];
export const SUBSCRIPTION_COLORS = ['#8b5cf6', '#ec4899', '#3b82f6', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#6366f1'];
const MAX_AMOUNT = 100_000_000; // 1 000 000,00 €
const madridDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Euros to whole cents, rounding halves up on the decimal the user wrote (12.345 → 1235). */
export function cents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('invalid_amount', 'Importe no válido');
  // Ten decimals recover the written decimal from the binary double before rounding.
  const [whole, fraction] = Math.abs(value).toFixed(10).split('.');
  const result = Number(whole) * 100 + Number(fraction.slice(0, 2)) + (fraction[2] >= '5' ? 1 : 0);
  return value < 0 ? -result : result;
}

export const euros = (value) => value / 100;

export function amountCents(value, allowZero = false) {
  const number = cents(value);
  if (number < 0 || number > MAX_AMOUNT || (number === 0 && !allowZero)) fail('invalid_amount', 'El importe debe ser positivo y razonable');
  return number;
}

/** `percent` % of an amount in cents, rounded half up, without floating point drift. */
export function percentOf(amount, percent) {
  const scaled = BigInt(Math.round(Number(percent || 0) * 1e6));
  const numerator = BigInt(amount) * scaled * 2n + 100_000_000n;
  return Number(numerator / 200_000_000n);
}

/** Mirror of the web's sanitizeConcepto: drop control characters, trim, cap. */
export function cleanText(value, limit, code = 'invalid_text', message = 'Texto no válido') {
  if (typeof value !== 'string') fail(code, message);
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, limit);
  if (!text) fail(code, message);
  return text;
}

/** ISO date-time, or a plain date stored as UTC midnight like the web does. */
export function parseMoment(value) {
  const invalid = () => fail('invalid_date', 'Usa una fecha AAAA-MM-DD o una fecha y hora ISO');
  if (typeof value !== 'string') invalid();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) invalid();
    return day;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) invalid();
  const moment = new Date(match[4] ? value : `${value}Z`);
  if (Number.isNaN(moment.getTime())) invalid();
  parseMoment(match[1]);
  return moment;
}

/** Calendar day as 'YYYY-MM-DD': in Europe/Madrid for instants, as written for date strings. */
export function localDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : madridDay.format(value);
  if (typeof value === 'string') {
    const day = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const parsed = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  }
  return null;
}

/** The instant at which a Europe/Madrid calendar day starts. */
export function madridMidnight(year, month, day) {
  const guess = Date.UTC(year, month - 1, day);
  for (const offsetHours of [1, 2, 3]) {
    const candidate = new Date(guess - offsetHours * 3_600_000);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23', day: '2-digit' }).formatToParts(candidate);
    const read = (type) => Number(parts.find((part) => part.type === type).value);
    if (read('hour') === 0 && read('day') === day) return candidate;
  }
  return new Date(guess);
}

// --- Wallets ---------------------------------------------------------------

export const isActive = (hucha) => hucha.activa !== false;
const balance = (hucha) => cents(hucha.saldo_acumulado || 0);

/** Active wallets as [id, data], in the user's display order. */
export function ordered(huchas) {
  return Object.entries(huchas)
    .filter(([, hucha]) => isActive(hucha))
    .sort(([a, x], [b, y]) => (x.orden || 0) - (y.orden || 0) || (a < b ? -1 : a > b ? 1 : 0));
}

function pick(huchas, preferences, exclude = []) {
  const wallets = ordered(huchas).filter(([id, hucha]) => !exclude.includes(id) && !hucha.es_metalico);
  for (const wanted of preferences) {
    const found = wallets.find(([, hucha]) => wanted(hucha));
    if (found) return found[0];
  }
  return null;
}

/** Where unassigned money lands: the 'resto' wallet, else the main one. */
export const fallbackHucha = (huchas, exclude = []) =>
  pick(huchas, [(h) => h.tipo_aportacion === 'resto', (h) => h.es_principal, () => true], exclude);

/** Default wallet for an expense with no explicit wallet: main, then 'resto'. */
export const expenseHucha = (huchas) =>
  pick(huchas, [(h) => h.es_principal, (h) => h.tipo_aportacion === 'resto', () => true]);

/** Capacity left under a capped goal, in cents; null when the wallet is uncapped. */
export function room(hucha, pending = 0) {
  const goal = cents(hucha.objetivo || 0);
  return hucha.tope_objetivo && goal > 0 ? Math.max(0, goal - balance(hucha) - pending) : null;
}

/** Sum of percentage allocations across active wallets; `replacing` overrides some. */
export function percentageTotal(huchas, replacing = {}) {
  return ordered({ ...huchas, ...replacing })
    .filter(([, hucha]) => hucha.tipo_aportacion === 'porcentaje')
    .reduce((total, [, hucha]) => total + Number(hucha.valor_aportacion || 0), 0);
}

/**
 * Split an income across wallets: fixed amounts, then percentages, then the rest.
 *
 * Capped wallets only take what fits and a wallet in debt repays its lender
 * first, as the email synchroniser does. `plain` skips caps and debts: it is
 * the web's simpler split, used to undo incomes that carry no recorded split.
 * Returns { saldos: {hucha: cents}, deudas: {hucha: {importe, con}} }.
 */
export function distributeIncome(amount, huchas, plain = false) {
  const wallets = ordered(huchas).filter(([, hucha]) => !hucha.es_metalico);
  if (!wallets.length) fail('no_hucha', 'No hay ninguna cartera activa para repartir el ingreso');
  if (!plain && percentageTotal(huchas) > 100) fail('invalid_distribution', 'Los porcentajes de las carteras superan el 100 %; corrígelos antes');
  const saldos = {};
  const deudas = {};
  let remaining = amount;

  const credit = (id, hucha, share) => {
    let value = share;
    const lender = hucha.deuda_con;
    const debt = cents(hucha.deuda_pendiente || 0) - (deudas[id]?.importe || 0);
    if (!plain && debt > 0 && lender && lender !== id && huchas[lender] && isActive(huchas[lender])) {
      const payment = Math.min(debt, value);
      deudas[id] = { importe: (deudas[id]?.importe || 0) + payment, con: lender };
      saldos[lender] = (saldos[lender] || 0) + payment;
      value -= payment;
    }
    if (value) saldos[id] = (saldos[id] || 0) + value;
  };

  for (const kind of ['flat', 'porcentaje']) {
    for (const [id, hucha] of wallets) {
      if (hucha.tipo_aportacion !== kind || remaining <= 0) continue;
      let planned = kind === 'flat' ? cents(Number(hucha.valor_aportacion || 0)) : percentOf(amount, hucha.valor_aportacion);
      const free = plain || (kind === 'flat' && hucha.es_suscripciones) ? null : room(hucha, saldos[id] || 0);
      if (free !== null) planned = Math.min(planned, free);
      const share = Math.min(Math.max(planned, 0), remaining);
      if (share) {
        remaining -= share;
        credit(id, hucha, share);
      }
    }
  }
  if (remaining) {
    const target = fallbackHucha(huchas);
    credit(target, huchas[target], remaining);
  }
  return { saldos, deudas };
}

/**
 * Effects that undo an auto-distributed income.
 *
 * Uses the split recorded when the income was created; older incomes carry
 * none, so the split is recomputed from today's rules as the web does.
 * Shares of wallets that no longer exist or are archived fall on the rest wallet.
 */
export function incomeReversal(movement, huchas) {
  const amount = cents(movement.importe);
  const recorded = movement.reparto_aplicado;
  let saldos;
  let deudas = {};
  if (recorded && typeof recorded === 'object' && recorded.saldos && Object.keys(recorded.saldos).length) {
    saldos = Object.fromEntries(Object.entries(recorded.saldos).map(([id, value]) => [id, cents(value)]));
    deudas = Object.fromEntries(Object.entries(recorded.deudas || {}).map(([id, debt]) => [id, { importe: cents(debt.importe || 0), con: debt.con }]));
  } else {
    saldos = distributeIncome(amount, huchas, true).saldos;
  }
  const result = {};
  for (const [id, value] of Object.entries(saldos)) {
    const target = huchas[id] && isActive(huchas[id]) ? id : fallbackHucha(huchas);
    if (target === null) fail('no_hucha', 'No hay ninguna cartera activa para revertir el ingreso');
    result[target] = (result[target] || 0) - value;
  }
  const restored = Object.fromEntries(Object.entries(deudas).filter(([id, debt]) => huchas[id] && isActive(huchas[id]) && debt.importe));
  return { saldos: result, deudas: restored };
}

/** Shape stored on the movement so the income can be undone exactly. */
export function recordedSplit(split) {
  return {
    saldos: Object.fromEntries(Object.entries(split.saldos).map(([id, value]) => [id, euros(value)])),
    deudas: Object.fromEntries(Object.entries(split.deudas).map(([id, debt]) => [id, { importe: euros(debt.importe), con: debt.con }])),
  };
}

export const countsInStats = (movement) => !movement.es_interno && !movement.transfer_id;

// --- Compensations (a refund that offsets an expense) ----------------------

const sum = (rows, field = 'importe') => (rows || []).reduce((total, row) => total + cents(row[field]), 0);

/** Cents of a movement not yet consumed by compensations. */
export function available(movement) {
  const amount = cents(movement.importe || 0);
  if (amount < 0) return 0;
  if (movement.tipo === 'gasto') {
    if (movement.importe_neto != null) return Math.max(0, cents(movement.importe_neto));
    return Math.max(0, amount - sum(movement.compensado_por_detalles));
  }
  if (movement.compensa_movimiento_id) return 0; // Legacy links already consumed the whole income.
  return Math.max(0, amount - sum(movement.compensaciones_destinos));
}

/** Port of the web's compensationUpdates. `allocations` is [[movement, cents]]. */
export function compensationUpdates(base, allocations) {
  if (!allocations.length || base.es_interno || base.transfer_id) fail('invalid_compensation', 'Selecciona movimientos externos para compensar');
  const seen = new Set();
  let total = 0;
  for (const [movement, amount] of allocations) {
    if (seen.has(movement.id) || movement.id === base.id || movement.tipo === base.tipo || movement.es_interno || movement.transfer_id) {
      fail('invalid_compensation', 'La compensación necesita un gasto y un ingreso distintos');
    }
    seen.add(movement.id);
    if (amount <= 0 || amount > available(movement)) fail('invalid_compensation', 'El importe supera el saldo disponible o no es válido');
    total += amount;
  }
  if (total > available(base)) fail('invalid_compensation', 'El importe supera el saldo disponible del movimiento');
  const current = { [base.id]: { ...base } };
  for (const [movement] of allocations) current[movement.id] = { ...movement };
  const updates = {};
  for (const [movement, amount] of allocations) {
    const gasto = current[base.tipo === 'gasto' ? base.id : movement.id];
    const ingreso = current[base.tipo === 'ingreso' ? base.id : movement.id];
    const previousDetail = (gasto.compensado_por_detalles || []).find((d) => d.ingreso_id === ingreso.id);
    const detalles = [...(gasto.compensado_por_detalles || []).filter((d) => d.ingreso_id !== ingreso.id),
      { ingreso_id: ingreso.id, importe: euros((previousDetail ? cents(previousDetail.importe) : 0) + amount) }];
    const previousTarget = (ingreso.compensaciones_destinos || []).find((d) => d.gasto_id === gasto.id);
    const destinos = [...(ingreso.compensaciones_destinos || []).filter((d) => d.gasto_id !== gasto.id),
      { gasto_id: gasto.id, importe: euros((previousTarget ? cents(previousTarget.importe) : 0) + amount) }];
    const gastoUpdate = { compensado_por_detalles: detalles, importe_neto: euros(available(gasto) - amount) };
    const ingresoUpdate = { compensaciones_destinos: destinos };
    Object.assign(gasto, gastoUpdate);
    Object.assign(ingreso, ingresoUpdate);
    updates[gasto.id] = { ...updates[gasto.id], ...gastoUpdate };
    updates[ingreso.id] = { ...updates[ingreso.id], ...ingresoUpdate };
  }
  return updates;
}

export function linkedIds(movement) {
  const ids = movement.tipo === 'gasto'
    ? [...(movement.compensado_por || []), ...(movement.compensado_por_detalles || []).map((d) => d.ingreso_id)]
    : [...(movement.compensa_movimiento_id ? [movement.compensa_movimiento_id] : []), ...(movement.compensaciones_destinos || []).map((d) => d.gasto_id)];
  return [...new Set(ids)];
}

/** Port of the web's unlinkCompensationUpdates. A null value means 'delete the field'. */
export function unlinkUpdates(base, related) {
  const updates = {};
  let current = { ...base };
  for (const target of related) {
    if (target.tipo === base.tipo) continue;
    const [gasto, ingreso] = base.tipo === 'gasto' ? [current, target] : [target, current];
    const detalle = (gasto.compensado_por_detalles || []).find((d) => d.ingreso_id === ingreso.id);
    const destino = (ingreso.compensaciones_destinos || []).find((d) => d.gasto_id === gasto.id);
    const legacy = (gasto.compensado_por || []).includes(ingreso.id) || ingreso.compensa_movimiento_id === gasto.id;
    if (!detalle && !destino && !legacy) continue;
    const amount = cents((detalle || destino || ingreso).importe);
    const detalles = (gasto.compensado_por_detalles || []).filter((d) => d.ingreso_id !== ingreso.id);
    const legacyIds = (gasto.compensado_por || []).filter((id) => id !== ingreso.id);
    const destinos = (ingreso.compensaciones_destinos || []).filter((d) => d.gasto_id !== gasto.id);
    const stillLinked = detalles.length > 0 || legacyIds.length > 0;
    const gastoUpdate = {
      compensado_por_detalles: detalles.length ? detalles : null,
      compensado_por: legacyIds.length ? legacyIds : null,
      importe_neto: stillLinked ? euros(Math.min(cents(gasto.importe), available(gasto) + amount)) : null,
    };
    const ingresoUpdate = {
      compensaciones_destinos: destinos.length ? destinos : null,
      compensa_movimiento_id: ingreso.compensa_movimiento_id === gasto.id ? null : ingreso.compensa_movimiento_id ?? null,
    };
    updates[gasto.id] = { ...updates[gasto.id], ...gastoUpdate };
    updates[ingreso.id] = { ...updates[ingreso.id], ...ingresoUpdate };
    current = { ...current, ...(base.tipo === 'gasto' ? gastoUpdate : ingresoUpdate) };
  }
  return updates;
}

// --- Subscriptions ---------------------------------------------------------

/** Cents the subscription costs per year-twelfth: exact for every cadence. */
const yearlyTwelfths = (subscription) =>
  cents(Number(subscription.mi_parte ?? subscription.importe ?? 0)) * (12 / (FREQUENCY_MONTHS[subscription.frecuencia] || 1));

const halfUp = (numerator, denominator) => Math.floor((2 * numerator + denominator) / (2 * denominator));

/** Monthly cost of a subscription in euros (the user's share when it is shared). */
export const monthlyAmount = (subscription) => yearlyTwelfths(subscription) / 1200;

/** Sum of monthly costs in euros, rounded once at the end. */
export const monthlyTotal = (subscriptions) => euros(halfUp(subscriptions.reduce((total, s) => total + yearlyTwelfths(s), 0), 12));

/** Monthly target of the automatic 'Suscripciones' wallet, in euros. */
export const subscriptionsTarget = (subscriptions, systemId) =>
  monthlyTotal(subscriptions.filter((s) => s.activa && (!s.hucha_id || s.hucha_id === systemId)));

const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const isoDay = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(Math.min(Math.max(Number(day) || 1, 1), daysIn(year, month))).padStart(2, '0')}`;

function anchorDate(subscription, fallback) {
  const explicit = localDate(subscription.fecha_inicio);
  if (explicit) return explicit;
  const created = localDate(subscription.created_at) || fallback;
  return isoDay(Number(created.slice(0, 4)), Number(created.slice(5, 7)), subscription.dia_pago || Number(created.slice(8, 10)));
}

/** Next billing day ('YYYY-MM-DD') on or after `start`, following the anchor and cadence. */
export function nextCharge(subscription, start, includeToday = true) {
  const anchor = anchorDate(subscription, start);
  const [anchorYear, anchorMonth, anchorDay] = anchor.split('-').map(Number);
  const [startYear, startMonth] = start.split('-').map(Number);
  const cadence = FREQUENCY_MONTHS[subscription.frecuencia] || 1;
  const day = subscription.dia_pago || anchorDay;
  for (let offset = 0; offset <= 120; offset += 1) {
    const index = startYear * 12 + startMonth - 1 + offset;
    const [year, month] = [Math.floor(index / 12), (index % 12) + 1];
    const distance = (year - anchorYear) * 12 + month - anchorMonth;
    if (distance < 0 || distance % cadence) continue;
    const charge = isoDay(year, month, day);
    if (charge > start || (includeToday && charge === start)) return charge;
  }
  return isoDay(startYear + 10, startMonth, day);
}

// --- Categories ------------------------------------------------------------

export const nameKey = (label) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function customCategoryId(label, tipo) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${nameKey(label)}:${tipo}`));
  return `custom_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
