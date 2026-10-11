/**
 * Owner-scoped finance operations behind the MCP tools.
 *
 * They mirror what the signed-in user can do in the web app. Every write runs in
 * one Firestore transaction with all reads first, and money moves in whole cents.
 * The owner always comes from the verified credential, never from tool arguments.
 */
import catalog from '../../tracker-backend/prompts/categories.json';
import { FlowtError, fail } from './errors.js';
import { DELETE_FIELD, SERVER_TIMESTAMP } from './firestore.js';
import * as d from './financeDomain.js';
import { checkedId, documentId, plain, sha256Hex, stableJson, visible } from './util.js';

const NOW = SERVER_TIMESTAMP;
const SCAN_LIMIT = 300;
const SUMMARY_LIMIT = 1500;
const OWNER = 'id_propietario';

const round2 = (value) => Math.round(value * 100) / 100;
const orDelete = (update) => Object.fromEntries(Object.entries(update).map(([key, value]) => [key, value === null ? DELETE_FIELD : value]));

export class FinanceService {
  /**
   * @param {object} db  src/firestore.js Firestore (or the tests' MemoryDb)
   * @param {{ reviews?: object, now?: () => Date }} [options]
   */
  constructor(db, { reviews = null, now = () => new Date() } = {}) {
    this.db = db;
    this.reviews = reviews;
    this.now = now;
  }

  /** Run one write transaction; an operation_id makes a network retry return the first result. */
  async _write(owner, name, args, operationId, body) {
    if (operationId == null) return plain(await this.db.runTransaction(body));
    const key = await documentId(owner, `mcp:${checkedId(operationId)}`);
    const digest = await sha256Hex(stableJson([name, args]));
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.doc('mcp_operations', key);
      const previous = await this.db.get(ref, tx);
      if (previous.exists) {
        if (previous.data[OWNER] !== owner || previous.data.request_digest !== digest) {
          throw new FlowtError('operation_conflict', 'ID de operación reutilizado con otros datos');
        }
        return previous.data.result;
      }
      const result = plain(await body(tx));
      tx.create(ref, { [OWNER]: owner, tool: name, request_digest: digest, result, created_at: NOW,
        expires_at: new Date(this.now().getTime() + 30 * 86_400_000) });
      return result;
    });
  }

  // --- Shared reads -------------------------------------------------------

  _ref(collection, key) {
    return this.db.doc(collection, checkedId(key));
  }

  async _doc(collection, key, owner, tx = null) {
    const ref = this._ref(collection, key);
    const snapshot = await this.db.get(ref, tx);
    if (!snapshot.exists || snapshot.data[OWNER] !== owner) throw new FlowtError('not_found', 'Documento no disponible');
    return { ref, data: snapshot.data, snapshot };
  }

  async _owned(collection, owner, tx = null) {
    const rows = await this.db.query({ collection, where: [[OWNER, '==', owner]] }, tx);
    return Object.fromEntries(rows.map((snapshot) => [snapshot.id, snapshot.data]));
  }

  async _categories(owner, tx = null) {
    const custom = await this.db.query({ collection: 'items', parent: `categorias/${owner}` }, tx);
    return [...catalog, ...custom.map((s) => ({ id: s.id, label: s.data.label, tipo: s.data.tipo }))];
  }

  async _requireCategory(owner, category, tipo, tx = null) {
    const categories = await this._categories(owner, tx);
    if (!categories.some((c) => c.id === category && [tipo, 'ambos'].includes(c.tipo))) {
      fail('invalid_category', 'Categoría no válida para este tipo de movimiento');
    }
  }

  async _single(collection, owner, tx = null) {
    const snapshot = await this.db.get(this.db.doc(collection, owner), tx);
    return snapshot.exists ? snapshot.data : {};
  }

  _usable(huchaId, huchas) {
    const hucha = huchas[checkedId(huchaId)];
    if (!hucha || !d.isActive(hucha)) fail('invalid_hucha', 'La cartera no existe o está archivada');
    return hucha;
  }

  _movementQuery(owner, startDate = null, endDate = null) {
    const start = startDate ? d.parseMoment(startDate) : null;
    const end = endDate ? d.parseMoment(endDate) : null;
    if (start && end && start >= end) fail('invalid_dates', 'El intervalo de fechas está vacío');
    const where = [[OWNER, '==', owner]];
    if (start) where.push(['fecha_operacion', '>=', start]);
    if (end) where.push(['fecha_operacion', '<', end]);
    return { collection: 'movimientos', where, orderBy: [['fecha_operacion', 'desc']] };
  }

  // --- Shared writes ------------------------------------------------------

  /** Persist balance deltas (cents) plus extra wallet fields; returns before/after per wallet. */
  _apply(tx, huchas, deltas, extra = {}, created = {}) {
    const summary = {};
    for (const id of [...new Set([...Object.keys(deltas), ...Object.keys(extra), ...Object.keys(created)])].sort()) {
      const current = created[id] || huchas[id];
      const before = d.cents(current.saldo_acumulado || 0);
      const after = before + (deltas[id] || 0);
      const fields = { ...extra[id], updated_at: NOW };
      if (after !== before) fields.saldo_acumulado = d.euros(after);
      if (created[id]) {
        tx.set(this._ref('huchas', id), { ...created[id], ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== DELETE_FIELD)) });
      } else if (Object.keys(fields).length > 1) {
        tx.update(this._ref('huchas', id), fields);
      }
      if (after !== before || created[id]) {
        summary[id] = { nombre: current.nombre, saldo_antes: d.euros(before), saldo_despues: d.euros(after) };
      }
    }
    return summary;
  }

  /** Wallet fields for debt repaid by an income, or owed again when that income is undone. */
  _debtFields(huchas, debts, restore = false) {
    const fields = {};
    for (const [id, debt] of Object.entries(debts)) {
      const owed = d.cents(huchas[id].deuda_pendiente || 0) + (restore ? debt.importe : -debt.importe);
      fields[id] = { deuda_pendiente: d.euros(Math.max(owed, 0)), deuda_con: owed > 0 ? debt.con : DELETE_FIELD };
    }
    return fields;
  }

  _bumpStats(tx, owner, stats, { ingresos = 0, gastos = 0 }) {
    if (!ingresos && !gastos) return;
    tx.set(this.db.doc('stats', owner), {
      total_ingresos: d.euros(Math.max(0, d.cents(stats.total_ingresos || 0) + ingresos)),
      total_gastos: d.euros(Math.max(0, d.cents(stats.total_gastos || 0) + gastos)),
      updated_at: NOW,
    }, { merge: true });
  }

  /** The cash wallet, provisioned on first use like the web does. */
  _cashHucha(owner, huchas) {
    for (const [id, hucha] of d.ordered(huchas)) {
      const name = (hucha.nombre || '').toLowerCase();
      if (hucha.es_metalico || name.includes('metalico') || name.includes('efectivo')) return [id, {}];
    }
    const id = this.db.newId();
    return [id, { [id]: { [OWNER]: owner, nombre: 'Efectivo', tipo_aportacion: 'flat', valor_aportacion: 0, objetivo: null,
      saldo_acumulado: 0, orden: Object.keys(huchas).length + 1, es_metalico: true, es_principal: false, activa: true,
      created_at: NOW, updated_at: NOW } }];
  }

  /** Wallet that gets an expense back: its own, or the default one if that is gone. */
  _refundHucha(movement, huchas) {
    const id = movement.hucha_id;
    return id && huchas[id] && d.isActive(huchas[id]) ? id : d.expenseHucha(huchas);
  }

  // --- Read tools ---------------------------------------------------------

  async _totals(owner, start, end) {
    const rows = await this.db.query({ ...this._movementQuery(owner, start.toISOString(), end ? end.toISOString() : null), limit: SUMMARY_LIMIT });
    let ingresos = 0;
    let gastos = 0;
    for (const { data } of rows) {
      if (!d.countsInStats(data)) continue;
      if (data.tipo === 'ingreso') ingresos += d.available(data);
      else gastos += d.available(data);
    }
    return { ingresos: d.euros(ingresos), gastos: d.euros(gastos), neto: d.euros(ingresos - gastos) };
  }

  async get_overview(owner) {
    const today = d.localDate(this.now());
    const [year, month] = today.split('-').map(Number);
    const monthStart = d.madridMidnight(year, month, 1);
    const previousStart = d.madridMidnight(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, 1);
    const [huchas, subscriptions, pending, stats, currentMonth, previousMonth] = await Promise.all([
      this._owned('huchas', owner),
      this._owned('suscripciones', owner),
      this.db.query({ collection: 'correos_pendientes', where: [[OWNER, '==', owner], ['procesado', '==', false]], limit: 100 }),
      this._single('stats', owner),
      this._totals(owner, monthStart, null),
      this._totals(owner, previousStart, monthStart),
    ]);
    const active = d.ordered(huchas);
    const live = Object.values(subscriptions).filter((s) => s.activa);
    return plain({
      date: today,
      total_balance: d.euros(active.reduce((total, [, hucha]) => total + d.cents(hucha.saldo_acumulado || 0), 0)),
      huchas: active.map(([id, hucha]) => visible(id, hucha)),
      current_month: currentMonth,
      previous_month: previousMonth,
      lifetime_totals: { total_ingresos: stats.total_ingresos ?? null, total_gastos: stats.total_gastos ?? null },
      subscriptions: { active: live.length, monthly_cost: d.monthlyTotal(live) },
      pending_emails: pending.length,
    });
  }

  async list_movements(owner, { start_date = null, end_date = null, tipo = null, hucha_id = null, categoria = null,
    text = null, include_internal = true, limit = 50, cursor = null } = {}) {
    const spec = { ...this._movementQuery(owner, start_date, end_date), limit: SCAN_LIMIT };
    if (cursor) {
      const snapshot = await this.db.get(this._ref('movimientos', cursor));
      if (!snapshot.exists || snapshot.data[OWNER] !== owner) throw new FlowtError('not_found', 'Cursor no válido');
      spec.startAfter = snapshot;
    }
    const needle = text ? d.nameKey(text).trim() : null;
    const rows = await this.db.query(spec);
    const items = [];
    let last = null;
    let scanned = 0;
    for (const snapshot of rows) {
      scanned += 1;
      last = snapshot.id;
      const movement = snapshot.data;
      if (tipo && movement.tipo !== tipo) continue;
      if (hucha_id && movement.hucha_id !== hucha_id) continue;
      if (categoria && movement.categoria !== categoria) continue;
      if (!include_internal && !d.countsInStats(movement)) continue;
      if (needle && !d.nameKey(`${movement.concepto || ''} ${movement.original_concept || ''}`).includes(needle)) continue;
      items.push(visible(snapshot.id, movement));
      if (items.length === limit) break;
    }
    // A page may be short because of filters: follow next_cursor until it is null.
    const more = items.length === limit || scanned === SCAN_LIMIT;
    return plain({ items, next_cursor: more ? last : null });
  }

  async get_movement(owner, { movement_id }) {
    const { data: movement } = await this._doc('movimientos', movement_id, owner);
    const linked = await this.db.getAll(d.linkedIds(movement).map((id) => this._ref('movimientos', id)));
    const related = Object.fromEntries(linked.filter((s) => s.exists && s.data[OWNER] === owner).map((s) => [s.id, visible(s.id, s.data)]));
    if (movement.transfer_id) {
      const legs = await this.db.query({ collection: 'movimientos', where: [[OWNER, '==', owner], ['transfer_id', '==', movement.transfer_id]] });
      for (const leg of legs) if (leg.id !== movement_id) related[leg.id] = visible(leg.id, leg.data);
    }
    return plain({ movement: visible(movement_id, movement), related: Object.values(related) });
  }

  async summarize_movements(owner, { start_date, end_date, group_by = 'category' }) {
    const [huchas, categories, rows] = await Promise.all([
      this._owned('huchas', owner),
      this._categories(owner),
      this.db.query({ ...this._movementQuery(owner, start_date, end_date), limit: SUMMARY_LIMIT }),
    ]);
    const labels = Object.fromEntries(categories.map((c) => [c.id, c.label]));
    const groups = {};
    for (const { data: movement } of rows) {
      if (!d.countsInStats(movement)) continue;
      let key;
      let label;
      if (group_by === 'month') {
        key = (d.localDate(movement.fecha_operacion) || 'sin_fecha').slice(0, 7);
        label = key;
      } else if (group_by === 'hucha') {
        key = movement.hucha_id || 'sin_cartera';
        label = huchas[key]?.nombre || (movement.tipo === 'ingreso' ? 'Reparto automático' : 'Sin cartera');
      } else {
        key = movement.categoria || 'sin_categorizar';
        label = labels[key] || key;
      }
      const group = (groups[key] ||= { key, label, ingresos: 0, gastos: 0, movements: 0 });
      group[movement.tipo === 'ingreso' ? 'ingresos' : 'gastos'] += d.available(movement);
      group.movements += 1;
    }
    const list = Object.values(groups).sort((a, b) => (group_by === 'month'
      ? (a.key < b.key ? -1 : 1)
      : (b.gastos + b.ingresos) - (a.gastos + a.ingresos)));
    const totals = { ingresos: d.euros(list.reduce((t, g) => t + g.ingresos, 0)), gastos: d.euros(list.reduce((t, g) => t + g.gastos, 0)) };
    for (const group of list) {
      group.ingresos = d.euros(group.ingresos);
      group.gastos = d.euros(group.gastos);
    }
    // Truncated means the range holds more movements than one call reads: narrow the dates.
    return { group_by, groups: list, totals, truncated: rows.length === SUMMARY_LIMIT };
  }

  async list_huchas(owner, { include_archived = false } = {}) {
    const huchas = await this._owned('huchas', owner);
    const rows = Object.entries(huchas).sort(([a, x], [b, y]) => (x.orden || 0) - (y.orden || 0) || (a < b ? -1 : 1));
    return plain({ items: rows.filter(([, hucha]) => include_archived || d.isActive(hucha)).map(([id, hucha]) => visible(id, hucha)) });
  }

  async list_subscriptions(owner) {
    const today = d.localDate(this.now());
    const subscriptions = await this._owned('suscripciones', owner);
    const items = Object.entries(subscriptions)
      .sort(([, x], [, y]) => ((x.nombre || '') < (y.nombre || '') ? -1 : 1))
      .map(([id, s]) => ({ ...visible(id, s), monthly_cost: round2(d.monthlyAmount(s)), next_charge: d.nextCharge(s, today) }));
    return plain({ items, monthly_cost: d.monthlyTotal(Object.values(subscriptions).filter((s) => s.activa)) });
  }

  async list_categories(owner) {
    const [categories, config] = await Promise.all([this._categories(owner), this._single('review_configuration', owner)]);
    return plain({ categories, category_huchas: config.category_huchas || {}, subscription_categories: d.SUBSCRIPTION_CATEGORIES });
  }

  async list_pending_emails(owner) {
    const rows = await this.db.query({ collection: 'correos_pendientes', where: [[OWNER, '==', owner], ['procesado', '==', false]], limit: 50 });
    return plain({ items: rows.map((s) => visible(s.id, s.data)) });
  }

  async list_email_history(owner, { limit = 20, cursor = null } = {}) {
    const spec = { collection: 'correos_historico', where: [[OWNER, '==', owner]], orderBy: [['created_at', 'desc']], limit };
    if (cursor) {
      const snapshot = await this.db.get(this._ref('correos_historico', cursor));
      if (!snapshot.exists || snapshot.data[OWNER] !== owner) throw new FlowtError('not_found', 'Cursor no válido');
      spec.startAfter = snapshot;
    }
    const rows = await this.db.query(spec);
    const items = rows.map((snapshot) => {
      const { cuerpo = '', ...email } = visible(snapshot.id, snapshot.data);
      const body = cuerpo || '';
      return { ...email, excerpt: body.slice(0, 400), truncated: body.length > 400 };
    });
    return plain({ items, next_cursor: rows.length === limit ? rows[rows.length - 1].id : null });
  }

  async get_email(owner, { email_id }) {
    for (const collection of ['correos_historico', 'correos_pendientes']) {
      const snapshot = await this.db.get(this._ref(collection, email_id));
      if (snapshot.exists && snapshot.data[OWNER] === owner) return plain({ source: collection, email: visible(snapshot.id, snapshot.data) });
    }
    throw new FlowtError('not_found', 'Correo no disponible');
  }

  // --- Movements ----------------------------------------------------------

  /** A user's own correction: same planner and field protection as an edit in the web. */
  update_movement(owner, args) {
    return this.reviews.edit_movement(owner, args);
  }

  create_movement(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'create_movement', args, operation_id, async (tx) => {
      const { tipo, concepto, importe, fecha_operacion, hucha_id = null, categoria = null, es_metalico = false, es_interno = false } = args;
      const amount = d.amountCents(importe);
      const name = d.cleanText(concepto, 200, 'invalid_name', 'Concepto no válido');
      const moment = d.parseMoment(fecha_operacion);
      const huchas = await this._owned('huchas', owner, tx);
      const stats = await this._single('stats', owner, tx);
      const config = await this._single('review_configuration', owner, tx);
      if (categoria != null) await this._requireCategory(owner, categoria, tipo, tx);
      if (!d.ordered(huchas).length) fail('no_hucha', 'Crea una cartera antes de registrar movimientos');
      const movement = { [OWNER]: owner, tipo, concepto: name, importe: d.euros(amount), moneda: 'EUR', fecha_operacion: moment,
        es_metalico: Boolean(es_metalico), es_interno: Boolean(es_interno), created_at: NOW };
      const protectedFields = ['concepto'];
      let created = {};
      let deltas = {};
      let debts = {};
      let target = hucha_id;
      if (es_metalico) {
        [target, created] = this._cashHucha(owner, huchas);
      } else if (target) {
        movement.es_metalico = Boolean(this._usable(target, huchas).es_metalico);
        protectedFields.push('hucha_id');
      }
      if (categoria != null) {
        movement.categoria = categoria;
        protectedFields.push('categoria');
      }
      if (tipo === 'gasto') {
        if (!target) {
          const mapped = (config.category_huchas || {})[categoria];
          target = mapped && huchas[mapped] && d.isActive(huchas[mapped]) ? mapped : d.expenseHucha(huchas);
        }
        if (!target) fail('no_hucha', 'Indica de qué cartera sale el gasto');
        deltas[target] = -amount;
      } else if (target) {
        deltas[target] = amount;
      } else {
        const split = d.distributeIncome(amount, huchas);
        deltas = split.saldos;
        debts = split.deudas;
        movement.reparto_aplicado = d.recordedSplit(split);
      }
      movement.hucha_id = target;
      movement.review_protected_fields = protectedFields;
      const ref = this.db.doc('movimientos', this.db.newId());
      const changes = this._apply(tx, huchas, deltas, this._debtFields(huchas, debts), created);
      if (d.countsInStats(movement)) this._bumpStats(tx, owner, stats, { [tipo === 'ingreso' ? 'ingresos' : 'gastos']: amount });
      tx.set(ref, movement);
      return { movement: visible(ref.id, movement), hucha_changes: changes };
    });
  }

  create_cash_withdrawal(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'create_cash_withdrawal', args, operation_id, async (tx) => {
      const { hucha_origen_id, importe, concepto, fecha_operacion } = args;
      const amount = d.amountCents(importe);
      const name = d.cleanText(concepto, 150, 'invalid_name', 'Concepto no válido');
      const moment = d.parseMoment(fecha_operacion);
      const huchas = await this._owned('huchas', owner, tx);
      const origin = this._usable(hucha_origen_id, huchas);
      const [cashId, created] = this._cashHucha(owner, huchas);
      if (cashId === hucha_origen_id) fail('invalid_hucha', 'La cartera de origen y Efectivo deben ser distintas');
      if (d.cents(origin.saldo_acumulado || 0) < amount) fail('insufficient_balance', 'Saldo insuficiente en la cartera de origen');
      const base = { [OWNER]: owner, importe: d.euros(amount), fecha_operacion: moment, es_interno: true,
        transfer_id: `transfer-${this.db.newId()}`, created_at: NOW };
      const legs = [
        { ...base, tipo: 'gasto', concepto: `Retirada de efectivo: ${name}`, hucha_id: hucha_origen_id },
        { ...base, tipo: 'ingreso', concepto: `Entrada en efectivo: ${name}`, hucha_id: cashId, es_metalico: true },
      ].map((leg) => [this.db.doc('movimientos', this.db.newId()), leg]);
      const changes = this._apply(tx, huchas, { [hucha_origen_id]: -amount, [cashId]: amount }, {}, created);
      for (const [ref, leg] of legs) tx.set(ref, leg);
      return { movements: legs.map(([ref, leg]) => visible(ref.id, leg)), hucha_changes: changes };
    });
  }

  delete_movement(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'delete_movement', args, operation_id, async (tx) => {
      const { movement_id } = args;
      const { ref, data: movement } = await this._doc('movimientos', movement_id, owner, tx);
      const huchas = await this._owned('huchas', owner, tx);
      const stats = await this._single('stats', owner, tx);
      const amount = d.cents(movement.importe || 0);
      if (movement.transfer_id) {
        // Both legs of an internal transfer go together, or the wallets stop adding up.
        const legs = await this.db.query({ collection: 'movimientos', where: [[OWNER, '==', owner], ['transfer_id', '==', movement.transfer_id]] }, tx);
        if (legs.length < 2) fail('incomplete_transfer', 'No se puede eliminar una transferencia sin su movimiento vinculado');
        const deltas = {};
        for (const { data: leg } of legs) {
          if (!huchas[leg.hucha_id]) fail('incomplete_transfer', 'La transferencia no tiene carteras válidas para poder revertirse');
          const value = d.cents(leg.importe || 0);
          deltas[leg.hucha_id] = (deltas[leg.hucha_id] || 0) + (leg.tipo === 'gasto' ? value : -value);
        }
        const changes = this._apply(tx, huchas, deltas);
        for (const leg of legs) tx.delete(leg.ref);
        return { deleted: legs.map((leg) => visible(leg.id, leg.data)), hucha_changes: changes };
      }
      const linked = await this.db.getAll(d.linkedIds(movement).map((id) => this._ref('movimientos', id)), tx);
      const related = linked.filter((s) => s.exists && s.data[OWNER] === owner).map((s) => ({ ...s.data, id: s.id }));
      const unlinked = d.unlinkUpdates({ ...movement, id: movement_id }, related);
      let deltas = {};
      let debts = {};
      if (movement.tipo === 'gasto') {
        const target = this._refundHucha(movement, huchas);
        if (target) deltas[target] = amount;
      } else if (movement.hucha_id) {
        if (huchas[movement.hucha_id]) deltas[movement.hucha_id] = -amount;
      } else if (d.ordered(huchas).length) {
        const reversal = d.incomeReversal(movement, huchas);
        deltas = reversal.saldos;
        debts = reversal.deudas;
      }
      const changes = this._apply(tx, huchas, deltas, this._debtFields(huchas, debts, true));
      for (const [otherId, update] of Object.entries(unlinked)) {
        if (otherId !== movement_id) tx.update(this._ref('movimientos', otherId), { ...orDelete(update), updated_at: NOW });
      }
      if (d.countsInStats(movement)) this._bumpStats(tx, owner, stats, { [movement.tipo === 'ingreso' ? 'ingresos' : 'gastos']: -amount });
      tx.delete(ref);
      return { deleted: [visible(movement_id, movement)], hucha_changes: changes,
        unlinked_movements: Object.keys(unlinked).filter((id) => id !== movement_id) };
    });
  }

  convert_movement(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'convert_movement', args, operation_id, async (tx) => {
      const { movement_id, target_hucha_id = null, distribution = null } = args;
      const { ref, data: movement } = await this._doc('movimientos', movement_id, owner, tx);
      if (movement.es_interno || movement.transfer_id) fail('ineligible_movement', 'Las transferencias internas no se pueden convertir');
      if (d.linkedIds(movement).length) fail('ineligible_movement', 'Deshaz primero las compensaciones de este movimiento');
      const huchas = await this._owned('huchas', owner, tx);
      const stats = await this._single('stats', owner, tx);
      const amount = d.cents(movement.importe || 0);
      let deltas = {};
      let extra;
      let statChange;
      const update = { categoria: DELETE_FIELD, categoria_sugerida: DELETE_FIELD, categoria_confianza: DELETE_FIELD, updated_at: NOW,
        review_protected_fields: [...new Set([...(movement.review_protected_fields || []), 'hucha_id', 'categoria'])].sort() };
      if (movement.tipo === 'gasto') {
        if (target_hucha_id) fail('invalid_arguments', 'target_hucha_id solo se usa al convertir un ingreso en gasto');
        const refund = this._refundHucha(movement, huchas);
        let split;
        if (distribution) {
          const saldos = {};
          for (const row of distribution) {
            this._usable(row.hucha_id, huchas);
            saldos[row.hucha_id] = (saldos[row.hucha_id] || 0) + d.amountCents(row.importe);
          }
          if (Object.values(saldos).reduce((a, b) => a + b, 0) !== amount) fail('invalid_distribution', 'El reparto debe sumar exactamente el importe del movimiento');
          split = { saldos, deudas: {} };
        } else {
          // Caps are measured after the expense has been handed back.
          const view = refund
            ? { ...huchas, [refund]: { ...huchas[refund], saldo_acumulado: d.euros(d.cents(huchas[refund].saldo_acumulado || 0) + amount) } }
            : huchas;
          split = d.distributeIncome(amount, view);
        }
        deltas = { ...split.saldos };
        if (refund) deltas[refund] = (deltas[refund] || 0) + amount;
        extra = this._debtFields(huchas, split.deudas);
        Object.assign(update, { tipo: 'ingreso', hucha_id: DELETE_FIELD, reparto_aplicado: d.recordedSplit(split) });
        statChange = { ingresos: amount, gastos: -amount };
      } else {
        if (distribution) fail('invalid_arguments', 'distribution solo se usa al convertir un gasto en ingreso');
        if (!target_hucha_id) fail('missing_hucha', 'Indica la cartera de la que sale el gasto');
        this._usable(target_hucha_id, huchas);
        let debts = {};
        if (movement.hucha_id) {
          if (huchas[movement.hucha_id]) deltas[movement.hucha_id] = -amount;
        } else {
          const reversal = d.incomeReversal(movement, huchas);
          deltas = { ...reversal.saldos };
          debts = reversal.deudas;
        }
        deltas[target_hucha_id] = (deltas[target_hucha_id] || 0) - amount;
        extra = this._debtFields(huchas, debts, true);
        Object.assign(update, { tipo: 'gasto', hucha_id: target_hucha_id, reparto_aplicado: DELETE_FIELD });
        statChange = { ingresos: -amount, gastos: amount };
      }
      const changes = this._apply(tx, huchas, deltas, extra);
      this._bumpStats(tx, owner, stats, statChange);
      tx.update(ref, update);
      return { movement_id, tipo: update.tipo, hucha_changes: changes };
    });
  }

  link_compensation(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'link_compensation', args, operation_id, async (tx) => {
      const { movement_id, allocations } = args;
      const refs = [this._ref('movimientos', movement_id), ...allocations.map((row) => this._ref('movimientos', row.movement_id))];
      const [base, ...others] = await this.db.getAll(refs, tx);
      if ([base, ...others].some((s) => !s.exists || s.data[OWNER] !== owner)) throw new FlowtError('not_found', 'Documento no disponible');
      const pairs = allocations.map((row, index) => [{ ...others[index].data, id: row.movement_id }, d.amountCents(row.importe)]);
      const updates = d.compensationUpdates({ ...base.data, id: movement_id }, pairs);
      for (const [id, update] of Object.entries(updates)) tx.update(this._ref('movimientos', id), { ...update, updated_at: NOW });
      return { updated: updates };
    });
  }

  unlink_compensation(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'unlink_compensation', args, operation_id, async (tx) => {
      const { movement_id, other_movement_id = null } = args;
      const { data: base } = await this._doc('movimientos', movement_id, owner, tx);
      const ids = other_movement_id ? [other_movement_id] : d.linkedIds(base);
      const snapshots = (await this.db.getAll(ids.map((id) => this._ref('movimientos', id)), tx)).filter((s) => s.exists);
      if (snapshots.some((s) => s.data[OWNER] !== owner)) throw new FlowtError('not_found', 'Documento no disponible');
      const updates = d.unlinkUpdates({ ...base, id: movement_id }, snapshots.map((s) => ({ ...s.data, id: s.id })));
      if (!Object.keys(updates).length) fail('not_linked', 'Estos movimientos no están compensados entre sí');
      for (const [id, update] of Object.entries(updates)) tx.update(this._ref('movimientos', id), { ...orDelete(update), updated_at: NOW });
      return { updated: Object.keys(updates).sort() };
    });
  }

  // --- Wallets (huchas) ---------------------------------------------------

  _huchaRules(tipo, valor, objetivo, tope) {
    const value = tipo === 'resto' ? 0 : Number(valor || 0);
    if (!Number.isFinite(value) || value < 0 || (tipo === 'porcentaje' && value > 100)) fail('invalid_hucha', 'La aportación no es válida');
    const goal = objetivo ? d.euros(d.amountCents(objetivo)) : null;
    return { tipo_aportacion: tipo, valor_aportacion: value, objetivo: goal, tope_objetivo: Boolean(tope) && goal !== null };
  }

  /** Only one main wallet and one 'resto' wallet can exist at a time. */
  _exclusiveRoles(tx, huchas, huchaId, data) {
    for (const [otherId, other] of Object.entries(huchas)) {
      if (otherId === huchaId) continue;
      const fields = {};
      if (data.es_principal && other.es_principal) fields.es_principal = false;
      if (data.tipo_aportacion === 'resto' && other.tipo_aportacion === 'resto') Object.assign(fields, { tipo_aportacion: 'flat', valor_aportacion: 0 });
      if (Object.keys(fields).length) tx.update(this._ref('huchas', otherId), { ...fields, updated_at: NOW });
    }
  }

  create_hucha(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'create_hucha', args, operation_id, async (tx) => {
      const { nombre, tipo_aportacion, valor_aportacion = 0, objetivo = null, es_principal = false, tope_objetivo = false } = args;
      const huchas = await this._owned('huchas', owner, tx);
      const data = { [OWNER]: owner, nombre: d.cleanText(nombre, 100, 'invalid_name', 'Nombre no válido'),
        ...this._huchaRules(tipo_aportacion, valor_aportacion, objetivo, tope_objetivo),
        es_principal: Boolean(es_principal), activa: true, saldo_acumulado: 0, orden: Object.keys(huchas).length + 1,
        created_at: NOW, updated_at: NOW };
      const ref = this.db.doc('huchas', this.db.newId());
      if (d.percentageTotal(huchas, { [ref.id]: data }) > 100) fail('invalid_distribution', 'Los porcentajes de las carteras superarían el 100 %');
      this._exclusiveRoles(tx, huchas, ref.id, data);
      tx.set(ref, data);
      return { hucha: visible(ref.id, data) };
    });
  }

  update_hucha(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'update_hucha', args, operation_id, async (tx) => {
      const { hucha_id } = args;
      const huchas = await this._owned('huchas', owner, tx);
      const current = this._usable(hucha_id, huchas);
      const fields = {};
      if (args.nombre != null) fields.nombre = d.cleanText(args.nombre, 100, 'invalid_name', 'Nombre no válido');
      if (args.orden != null) fields.orden = args.orden;
      const rulesChanged = args.tipo_aportacion != null || args.valor_aportacion != null || 'objetivo' in args || args.tope_objetivo != null;
      if (rulesChanged) {
        if (current.es_suscripciones) fail('managed_hucha', 'La cartera de suscripciones se ajusta sola según tus suscripciones');
        Object.assign(fields, this._huchaRules(
          args.tipo_aportacion || current.tipo_aportacion,
          args.valor_aportacion ?? current.valor_aportacion,
          'objetivo' in args ? args.objetivo : current.objetivo,
          args.tope_objetivo ?? current.tope_objetivo));
      }
      if (args.es_principal != null) fields.es_principal = args.es_principal;
      if ('subsanar_con' in args) {
        const lender = args.subsanar_con;
        if (lender !== null && (lender === hucha_id || !huchas[lender] || !d.isActive(huchas[lender]))) fail('invalid_hucha', 'La cartera prestamista no es válida');
        fields.subsanar_con = lender;
      }
      if (args.subsanar_hasta != null) fields.subsanar_hasta = d.euros(d.amountCents(args.subsanar_hasta, true));
      if (!Object.keys(fields).length) fail('invalid_edit', 'No hay campos para editar');
      const merged = { ...current, ...fields };
      if (d.percentageTotal(huchas, { [hucha_id]: merged }) > 100) fail('invalid_distribution', 'Los porcentajes de las carteras superarían el 100 %');
      this._exclusiveRoles(tx, huchas, hucha_id, fields);
      tx.update(this._ref('huchas', hucha_id), { ...fields, updated_at: NOW });
      return { hucha: visible(hucha_id, merged) };
    });
  }

  archive_hucha(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'archive_hucha', args, operation_id, async (tx) => {
      const { hucha_id, distribution = null } = args;
      const huchas = await this._owned('huchas', owner, tx);
      const hucha = this._usable(hucha_id, huchas);
      const others = Object.fromEntries(Object.entries(huchas).filter(([id, h]) => id !== hucha_id && d.isActive(h)));
      if (hucha.es_suscripciones) fail('managed_hucha', 'Esta cartera es gestionada automáticamente por tus suscripciones');
      if (!Object.keys(others).length) fail('last_hucha', 'No puedes eliminar tu única cartera. Crea otra primero');
      const owedToIt = Object.values(others).some((h) => h.deuda_con === hucha_id && d.cents(h.deuda_pendiente || 0));
      if (d.cents(hucha.deuda_pendiente || 0) || owedToIt) fail('unsupported_debt', 'Resuelve antes la deuda entre carteras (revert_hucha_debt)');
      const balance = d.cents(hucha.saldo_acumulado || 0);
      if (balance < 0) fail('negative_balance', 'La cartera tiene saldo negativo; compénsalo con una transferencia antes de archivarla');
      let deltas = {};
      if (balance && distribution) {
        for (const row of distribution) {
          if (!others[row.hucha_id]) fail('invalid_hucha', 'El reparto solo admite otras carteras activas');
          deltas[row.hucha_id] = (deltas[row.hucha_id] || 0) + d.amountCents(row.importe);
        }
        if (Object.values(deltas).reduce((a, b) => a + b, 0) !== balance) fail('invalid_distribution', 'El reparto debe sumar exactamente el saldo de la cartera');
      } else if (balance) {
        deltas = d.distributeIncome(balance, others, true).saldos;
      }
      const changes = this._apply(tx, huchas, { ...deltas, [hucha_id]: -balance }, { [hucha_id]: { activa: false } });
      changes[hucha_id] ||= { nombre: hucha.nombre, saldo_antes: 0, saldo_despues: 0 };
      return { archived: hucha_id, hucha_changes: changes };
    });
  }

  restore_hucha(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'restore_hucha', args, operation_id, async (tx) => {
      const { ref, data: hucha } = await this._doc('huchas', args.hucha_id, owner, tx);
      tx.update(ref, { activa: true, updated_at: NOW });
      return { hucha: visible(args.hucha_id, { ...hucha, activa: true }) };
    });
  }

  transfer_between_huchas(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'transfer_between_huchas', args, operation_id, async (tx) => {
      const { from_hucha_id, to_hucha_id, importe } = args;
      if (from_hucha_id === to_hucha_id) fail('invalid_hucha', 'Debes seleccionar carteras distintas');
      const huchas = await this._owned('huchas', owner, tx);
      const source = this._usable(from_hucha_id, huchas);
      const target = this._usable(to_hucha_id, huchas);
      const amount = d.amountCents(importe);
      if (d.cents(source.saldo_acumulado || 0) < amount) fail('insufficient_balance', 'Saldo insuficiente en la cartera de origen');
      const free = d.room(target);
      const accepted = free === null ? amount : Math.min(amount, free);
      const deltas = { [from_hucha_id]: -amount, [to_hucha_id]: accepted };
      const overflow = amount - accepted;
      if (overflow) {
        // A capped destination passes the surplus on; it must never vanish or bounce back.
        const rest = d.fallbackHucha(huchas, [to_hucha_id]);
        const restRoom = rest ? d.room(huchas[rest]) : 0;
        if (!rest || rest === from_hucha_id || (restRoom !== null && restRoom < overflow)) {
          fail('no_capacity', 'La cartera destino está llena y no hay dónde dejar el sobrante');
        }
        deltas[rest] = overflow;
      }
      return { hucha_changes: this._apply(tx, huchas, deltas) };
    });
  }

  /** Two legs of an internal transfer; `expense`/`income` are [hucha_id, concept]. */
  _internalLegs(owner, amount, expense, income) {
    const base = { [OWNER]: owner, importe: d.euros(amount), es_interno: true, transfer_id: `transfer-${this.db.newId()}`,
      fecha_operacion: NOW, created_at: NOW };
    return [['gasto', expense], ['ingreso', income]].map(([tipo, [huchaId, concepto]]) =>
      [this.db.doc('movimientos', this.db.newId()), { ...base, tipo, hucha_id: huchaId, concepto }]);
  }

  cover_hucha_shortfall(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'cover_hucha_shortfall', args, operation_id, async (tx) => {
      const { hucha_id } = args;
      const huchas = await this._owned('huchas', owner, tx);
      const hucha = this._usable(hucha_id, huchas);
      const amount = d.cents(hucha.subsanar_hasta || 0) - d.cents(hucha.saldo_acumulado || 0);
      if (amount <= 0) fail('not_needed', 'Esta cartera no necesita ser subsanada');
      let lenderId = hucha.subsanar_con;
      if (!lenderId || lenderId === hucha_id || !huchas[lenderId] || !d.isActive(huchas[lenderId])) lenderId = d.fallbackHucha(huchas, [hucha_id]);
      if (!lenderId) fail('invalid_hucha', 'No se encontró una cartera prestamista');
      const debt = d.cents(hucha.deuda_pendiente || 0);
      if (debt && hucha.deuda_con != null && hucha.deuda_con !== lenderId) fail('unsupported_debt', 'La cartera ya debe dinero a otra cartera; revierte esa deuda antes');
      const lender = huchas[lenderId];
      const legs = this._internalLegs(owner, amount, [lenderId, `Préstamo a ${hucha.nombre}`], [hucha_id, `Subsanación desde ${lender.nombre}`]);
      const changes = this._apply(tx, huchas, { [lenderId]: -amount, [hucha_id]: amount },
        { [hucha_id]: { deuda_pendiente: d.euros(debt + amount), deuda_con: lenderId } });
      for (const [ref, leg] of legs) tx.set(ref, leg);
      return { amount: d.euros(amount), lender_hucha_id: lenderId, hucha_changes: changes };
    });
  }

  revert_hucha_debt(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'revert_hucha_debt', args, operation_id, async (tx) => {
      const { hucha_id } = args;
      const huchas = await this._owned('huchas', owner, tx);
      const hucha = this._usable(hucha_id, huchas);
      const debt = d.cents(hucha.deuda_pendiente || 0);
      const lenderId = hucha.deuda_con;
      if (!debt || !lenderId) fail('not_needed', 'Esta cartera no tiene ninguna deuda');
      if (!huchas[lenderId]) fail('invalid_hucha', 'No se puede revertir: la cartera prestamista ya no existe');
      const lender = huchas[lenderId];
      const legs = this._internalLegs(owner, debt, [hucha_id, `Reversión de subsanación (devuelto a ${lender.nombre})`],
        [lenderId, `Reversión de préstamo (recuperado de ${hucha.nombre})`]);
      const changes = this._apply(tx, huchas, { [hucha_id]: -debt, [lenderId]: debt },
        { [hucha_id]: { deuda_pendiente: DELETE_FIELD, deuda_con: DELETE_FIELD } });
      for (const [ref, leg] of legs) tx.set(ref, leg);
      return { amount: d.euros(debt), hucha_changes: changes };
    });
  }

  // --- Subscriptions ------------------------------------------------------

  _systemHucha(huchas, create) {
    const existing = Object.keys(huchas).sort().find((id) => huchas[id].es_suscripciones) || null;
    return existing || !create ? [existing, false] : [this.db.newId(), true];
  }

  /** Keep the automatic 'Suscripciones' wallet's monthly target equal to what it must cover. */
  _syncSystemHucha(tx, owner, huchas, subscriptions, systemId, isNew) {
    if (!systemId) return null;
    const target = d.subscriptionsTarget(Object.values(subscriptions), systemId);
    const fields = { objetivo: target || null, valor_aportacion: target, tipo_aportacion: 'flat', tope_objetivo: false, updated_at: NOW };
    if (isNew) {
      tx.set(this._ref('huchas', systemId), { [OWNER]: owner, nombre: 'Suscripciones', saldo_acumulado: 0,
        orden: Object.keys(huchas).length + 1, es_principal: false, es_suscripciones: true, activa: true, created_at: NOW, ...fields });
    } else {
      tx.update(this._ref('huchas', systemId), fields);
    }
    return { hucha_id: systemId, monthly_target: target };
  }

  _subscriptionFields(data, huchas) {
    const amount = d.amountCents(data.importe);
    const share = data.mi_parte ?? null;
    if (share !== null) {
      const own = d.amountCents(share);
      if (own > amount) fail('invalid_subscription', 'La parte propia debe estar entre 0 y el importe total');
    }
    if (!(data.frecuencia in d.FREQUENCY_MONTHS) || !d.SUBSCRIPTION_CATEGORIES.includes(data.categoria)) {
      fail('invalid_subscription', 'Frecuencia o categoría de suscripción no válida');
    }
    const start = d.localDate(data.fecha_inicio);
    if (start === null) fail('invalid_date', 'fecha_inicio debe ser AAAA-MM-DD');
    const day = data.dia_pago;
    if (!Number.isInteger(day) || day < 1 || day > 31) fail('invalid_subscription', 'El día de pago debe estar entre 1 y 31');
    if (data.hucha_id && (!huchas[data.hucha_id] || !d.isActive(huchas[data.hucha_id]))) fail('invalid_hucha', 'La cartera no existe o está archivada');
    return { nombre: d.cleanText(data.nombre, 100, 'invalid_name', 'Nombre no válido'), importe: d.euros(amount),
      frecuencia: data.frecuencia, fecha_inicio: start, dia_pago: day, categoria: data.categoria,
      color: data.color || d.SUBSCRIPTION_COLORS[0], activa: Boolean(data.activa ?? true), hucha_id: data.hucha_id || null,
      mi_parte: share === null ? null : d.euros(d.amountCents(share)) };
  }

  create_subscription(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'create_subscription', args, operation_id, async (tx) => {
      const huchas = await this._owned('huchas', owner, tx);
      const subscriptions = await this._owned('suscripciones', owner, tx);
      const [systemId, isNew] = this._systemHucha(huchas, true);
      const data = this._subscriptionFields({
        frecuencia: 'mensual', categoria: 'otros', activa: true, fecha_inicio: d.localDate(this.now()),
        color: d.SUBSCRIPTION_COLORS[Object.keys(subscriptions).length % d.SUBSCRIPTION_COLORS.length],
        ...Object.fromEntries(Object.entries(args).filter(([, value]) => value != null)),
      }, huchas);
      data.hucha_id ||= systemId;
      const ref = this.db.doc('suscripciones', this.db.newId());
      const synced = this._syncSystemHucha(tx, owner, huchas, { ...subscriptions, [ref.id]: data }, systemId, isNew);
      tx.set(ref, { ...data, [OWNER]: owner, created_at: NOW, updated_at: NOW });
      return { subscription: visible(ref.id, data), subscriptions_hucha: synced };
    });
  }

  update_subscription(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'update_subscription', args, operation_id, async (tx) => {
      const { subscription_id, ...changes } = args;
      const { ref, data: current } = await this._doc('suscripciones', subscription_id, owner, tx);
      if (!Object.keys(changes).length) fail('invalid_edit', 'No hay campos para editar');
      const huchas = await this._owned('huchas', owner, tx);
      const subscriptions = await this._owned('suscripciones', owner, tx);
      const data = this._subscriptionFields({
        frecuencia: 'mensual', categoria: 'otros', fecha_inicio: d.localDate(this.now()),
        ...Object.fromEntries(Object.entries(current).filter(([, value]) => value != null)),
        ...changes,
      }, huchas);
      const [systemId, isNew] = this._systemHucha(huchas, data.activa);
      data.hucha_id ||= systemId;
      const synced = this._syncSystemHucha(tx, owner, huchas, { ...subscriptions, [subscription_id]: data }, systemId, isNew);
      tx.update(ref, { ...data, updated_at: NOW });
      return { subscription: visible(subscription_id, { ...current, ...data }), subscriptions_hucha: synced };
    });
  }

  delete_subscription(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'delete_subscription', args, operation_id, async (tx) => {
      const { subscription_id } = args;
      const { ref, data: current } = await this._doc('suscripciones', subscription_id, owner, tx);
      const huchas = await this._owned('huchas', owner, tx);
      const remaining = await this._owned('suscripciones', owner, tx);
      delete remaining[subscription_id];
      const [systemId, isNew] = this._systemHucha(huchas, Object.values(remaining).some((s) => s.activa));
      const synced = this._syncSystemHucha(tx, owner, huchas, remaining, systemId, isNew);
      tx.delete(ref);
      return { deleted: visible(subscription_id, current), subscriptions_hucha: synced };
    });
  }

  cancel_subscription(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'cancel_subscription', args, operation_id, async (tx) => {
      const { subscription_id, undo = false } = args;
      const { ref, data: current } = await this._doc('suscripciones', subscription_id, owner, tx);
      // It stays active until the next charge, when the synchroniser removes it.
      const fields = undo
        ? { cancelando: false, cancel_at: null }
        : { cancelando: true, cancel_at: d.nextCharge(current, d.localDate(this.now()), false) };
      tx.update(ref, { ...fields, updated_at: NOW });
      return { subscription: visible(subscription_id, { ...current, ...fields }) };
    });
  }

  // --- Emails awaiting manual review --------------------------------------

  approve_pending_email(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'approve_pending_email', args, operation_id, async (tx) => {
      const { email_id, tipo, concepto, importe, fecha_operacion, hucha_id = null } = args;
      const { ref: emailRef, data: email } = await this._doc('correos_pendientes', email_id, owner, tx);
      if (email.procesado === true) throw new FlowtError('not_found', 'Este correo ya fue procesado o descartado');
      const amount = d.amountCents(importe);
      const name = d.cleanText(concepto, 200, 'invalid_name', 'Concepto no válido');
      const moment = d.parseMoment(fecha_operacion);
      const huchas = await this._owned('huchas', owner, tx);
      const stats = await this._single('stats', owner, tx);
      if (!d.ordered(huchas).length) fail('no_hucha', 'Crea una cartera antes de registrar movimientos');
      const movement = { [OWNER]: owner, tipo, concepto: name, importe: d.euros(amount), fecha_operacion: moment,
        id_correo_origen: email.email_id ?? null, review_protected_fields: hucha_id ? ['concepto', 'hucha_id'] : ['concepto'], created_at: NOW };
      let deltas = {};
      let debts = {};
      let target = hucha_id;
      if (target) {
        this._usable(target, huchas);
        deltas[target] = tipo === 'ingreso' ? amount : -amount;
      } else if (tipo === 'gasto') {
        target = d.expenseHucha(huchas);
        if (!target) fail('no_hucha', 'Indica de qué cartera sale el gasto');
        deltas[target] = -amount;
      } else {
        const split = d.distributeIncome(amount, huchas);
        deltas = split.saldos;
        debts = split.deudas;
        movement.reparto_aplicado = d.recordedSplit(split);
      }
      movement.hucha_id = target;
      const ref = this.db.doc('movimientos', this.db.newId());
      const changes = this._apply(tx, huchas, deltas, this._debtFields(huchas, debts));
      this._bumpStats(tx, owner, stats, { [tipo === 'ingreso' ? 'ingresos' : 'gastos']: amount });
      tx.set(ref, movement);
      // Same durable handoff as the web: the synchroniser queues the automatic review from it.
      tx.set(this._ref('review_handoffs', ref.id), { [OWNER]: owner, movement_id: ref.id, email_id: email.email_id ?? null, created_at: NOW });
      tx.delete(emailRef);
      return { movement: visible(ref.id, movement), hucha_changes: changes };
    });
  }

  discard_pending_email(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'discard_pending_email', args, operation_id, async (tx) => {
      const { ref } = await this._doc('correos_pendientes', args.email_id, owner, tx);
      tx.delete(ref);
      return { discarded: args.email_id };
    });
  }

  // --- Categories ---------------------------------------------------------

  create_category(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'create_category', args, operation_id, async (tx) => {
      const { label, tipo } = args;
      const name = d.cleanText(label, 200, 'invalid_name', 'Nombre no válido').split(/\s+/).join(' ');
      if (name.length > 50) fail('invalid_name', 'Escribe un nombre de entre 1 y 50 caracteres');
      const categories = await this._categories(owner, tx);
      if (categories.some((c) => d.nameKey(c.label || '') === d.nameKey(name) && (c.tipo === tipo || c.tipo === 'ambos' || tipo === 'ambos'))) {
        fail('duplicate_category', 'Ya tienes una categoría con ese nombre para este tipo de movimiento');
      }
      const ref = this.db.doc(`categorias/${owner}/items`, await d.customCategoryId(name, tipo));
      if ((await this.db.get(ref, tx)).exists) fail('duplicate_category', 'Ya tienes una categoría con ese nombre');
      tx.set(ref, { label: name, tipo, created_at: NOW });
      return { category: { id: ref.id, label: name, tipo } };
    });
  }

  set_category_hucha(owner, { operation_id = null, ...args }) {
    return this._write(owner, 'set_category_hucha', args, operation_id, async (tx) => {
      const { category, hucha_id = null } = args;
      const config = await this._single('review_configuration', owner, tx);
      const mapping = { ...(config.category_huchas || {}) };
      if (hucha_id) {
        await this._requireCategory(owner, category, 'gasto', tx);
        const { data: hucha } = await this._doc('huchas', hucha_id, owner, tx);
        if (!d.isActive(hucha) || hucha.es_metalico || hucha.es_interno) fail('invalid_hucha', 'Elige una cartera activa para gastos bancarios');
        mapping[category] = hucha_id;
        if (Object.keys(mapping).length > 200) fail('invalid_category', 'Demasiadas categorías asignadas');
      } else {
        delete mapping[checkedId(category)];
      }
      const revision = (config.revision || 0) + 1;
      tx.set(this.db.doc('review_configuration', owner), { category_huchas: mapping, revision, updated_at: NOW, last_changed_category: category });
      return { category_huchas: mapping, revision };
    });
  }
}
