/** Owner-scoped Firestore operations for the second review of bank movements. */
import catalog from '../../tracker-backend/prompts/categories.json';
import { FlowtError, fail } from './errors.js';
import { DELETE_FIELD, SERVER_TIMESTAMP } from './firestore.js';
import { cents } from './financeDomain.js';
import { activeHucha, planReview, reassignment } from './reviewDomain.js';
import { checkedId, documentId, plain, sha256Hex, stableJson } from './util.js';

const NOW = SERVER_TIMESTAMP;
const OWNER = 'id_propietario';
const OPEN_STATES = ['pending', 'retryable_error', 'waiting_evidence'];
const GUARDED_FIELDS = ['importe', 'tipo', 'moneda', 'hucha_id', 'es_interno', 'es_metalico', 'transfer_id'];

const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key] ?? null]));
const restoring = (before) => Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value === null ? DELETE_FIELD : value]));
const same = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a ?? null) === (b ?? null));
const emailOf = (movement) => movement.email_id || movement.id_correo_origen || null;

export class ReviewService {
  /**
   * @param {object} db  src/firestore.js Firestore (or the tests' MemoryDb)
   * @param {{ writesEnabled?: boolean, now?: () => Date }} [options]
   */
  constructor(db, { writesEnabled = false, now = () => new Date() } = {}) {
    this.db = db;
    this.writesEnabled = writesEnabled;
    this.now = now;
  }

  _ref(collection, key) {
    return this.db.doc(collection, checkedId(key));
  }

  _owns(collection, snapshot, owner) {
    // Configuration is scoped by its document ID rather than an owner field.
    return collection === 'review_configuration' ? snapshot.id === owner : snapshot.data[OWNER] === owner;
  }

  async _read(collection, key, owner, tx = null, optional = false) {
    const snapshot = await this.db.get(this._ref(collection, key), tx);
    if (!snapshot.exists) {
      if (optional) return { snapshot, data: {} };
      throw new FlowtError('not_found', 'Documento no disponible');
    }
    if (!this._owns(collection, snapshot, owner)) throw new FlowtError('not_found', 'Documento no disponible');
    return { snapshot, data: snapshot.data };
  }

  /** Several owned documents in one round trip; any missing or foreign one fails the whole read. */
  async _readAll(collection, keys, owner, tx = null) {
    const snapshots = await this.db.getAll(keys.map((key) => this._ref(collection, key)), tx);
    if (snapshots.some((s) => !s.exists || !this._owns(collection, s, owner))) throw new FlowtError('not_found', 'Documento no disponible');
    return snapshots;
  }

  async _owned(collection, owner, tx = null) {
    const rows = await this.db.query({ collection, where: [[OWNER, '==', owner]] }, tx);
    return Object.fromEntries(rows.map((snapshot) => [snapshot.id, snapshot.data]));
  }

  async _categories(owner, tx = null) {
    const custom = await this.db.query({ collection: 'items', parent: `categorias/${owner}` }, tx);
    return [...catalog, ...custom.map((s) => ({ ...s.data, id: s.id }))];
  }

  /** Review jobs of the given movements, only while their email is fully processed. */
  async _jobs(owner, movementIds, tx = null) {
    const jobIds = await Promise.all(movementIds.map((id) => documentId(owner, checkedId(id))));
    const jobs = await this._readAll('review_jobs', jobIds, owner, tx);
    const receipts = await this._readAll('email_processing', jobs.map((s) => s.data.processing_id), owner, tx);
    return jobs.map((snapshot, index) => {
      const processing = receipts[index].data;
      if (processing.state !== 'completed' || !(processing.movement_ids || []).includes(movementIds[index])) {
        fail('processing_incomplete', 'El correo aún no está procesado');
      }
      if (snapshot.data.movement_id !== movementIds[index]) fail('invalid_job', 'Revisión incoherente');
      return { jobId: snapshot.id, job: snapshot.data };
    });
  }

  async _job(owner, movementId, tx = null) {
    return (await this._jobs(owner, [movementId], tx))[0];
  }

  /** Whether the emails behind these movements finished processing (one flag per movement). */
  async _processingComplete(owner, movements, tx = null) {
    const emails = movements.map(emailOf);
    const refs = await Promise.all(emails.filter(Boolean).map(async (email) => this._ref('email_processing', await documentId(owner, email))));
    const receipts = await this.db.getAll(refs, tx);
    let next = 0;
    return emails.map((email) => {
      if (!email) return true; // Manual or legacy movements without a processing receipt.
      const receipt = receipts[next];
      next += 1;
      if (!receipt.exists) return true;
      if (receipt.data[OWNER] !== owner) throw new FlowtError('not_found', 'Documento no disponible');
      return receipt.data.state === 'completed';
    });
  }

  async list_pending_reviews(owner, { limit = 20, cursor = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('invalid_limit', 'El lote debe contener entre 1 y 50 casos');
    const spec = { collection: 'review_jobs', where: [[OWNER, '==', owner], ['state', 'in', OPEN_STATES]], limit };
    if (cursor) spec.startAfter = (await this._read('review_jobs', cursor, owner)).snapshot;
    // Bounded scan; caller must follow the cursor even when a page has no eligible cases.
    const snapshots = await this.db.query(spec);
    const now = this.now();
    const due = snapshots.filter((s) => !(s.data.next_attempt_at && s.data.next_attempt_at > now) && typeof s.data.processing_id === 'string');
    const receipts = await this.db.getAll(due.map((s) => this.db.doc('email_processing', s.data.processing_id)));
    const expectedIds = await Promise.all(due.map((s) => documentId(owner, String(s.data.movement_id))));
    const items = due.filter((s, index) => {
      const receipt = receipts[index];
      return s.id === expectedIds[index] && receipt.exists && receipt.data[OWNER] === owner && receipt.data.state === 'completed'
        && (receipt.data.movement_ids || []).includes(s.data.movement_id);
    }).map((s) => ({ job_id: s.id, ...s.data }));
    return plain({ items, next_cursor: snapshots.length === limit ? snapshots[snapshots.length - 1].id : null });
  }

  async get_movement_context(owner, { movement_id }) {
    const { snapshot, data: movement } = await this._read('movimientos', movement_id, owner);
    const { jobId, job } = await this._job(owner, movement_id);
    const emailId = emailOf(movement);
    const email = emailId ? (await this._read('correos_historico', emailId, owner, null, true)).data : null;
    return plain({ movement: { ...movement, id: movement_id }, version: snapshot.updateTime, job_id: jobId, review: job, email_id: emailId, email });
  }

  async get_finance_configuration(owner) {
    const [config, categories, huchas, subscriptions] = await Promise.all([
      this._read('review_configuration', owner, owner, null, true), this._categories(owner),
      this._owned('huchas', owner), this._owned('suscripciones', owner),
    ]);
    const withIds = (rows) => Object.entries(rows).map(([id, data]) => ({ ...data, id }));
    return plain({ categories, configuration: config.data, huchas: withIds(huchas), subscriptions: withIds(subscriptions) });
  }

  async search_related_movements(owner, { start_date, end_date, limit = 50, cursor = null }) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('invalid_limit', 'Límite de búsqueda no válido');
    const zoned = (value) => (typeof value === 'string' && /T.*(Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value) : new Date(Number.NaN));
    const [start, end] = [zoned(start_date), zoned(end_date)];
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) fail('invalid_dates', 'Usa fechas ISO con zona horaria y un intervalo válido');
    const spec = { collection: 'movimientos', where: [[OWNER, '==', owner], ['fecha_operacion', '>=', start], ['fecha_operacion', '<', end]],
      orderBy: [['fecha_operacion', 'asc']], limit };
    if (cursor) spec.startAfter = (await this._read('movimientos', cursor, owner)).snapshot;
    const snapshots = await this.db.query(spec);
    const complete = await this._processingComplete(owner, snapshots.map((s) => s.data));
    const items = snapshots.filter((_, index) => complete[index]).map((s) => ({ ...s.data, id: s.id, version: s.updateTime }));
    return plain({ items, next_cursor: snapshots.length === limit ? snapshots[snapshots.length - 1].id : null });
  }

  async _prepare(owner, movementId, proposal, tx) {
    const { snapshot, data: movement } = await this._read('movimientos', movementId, owner, tx);
    if (proposal.expected_version !== snapshot.updateTime) fail('version_conflict', 'El movimiento cambió; vuelve a consultar el contexto');
    const { jobId, job } = await this._job(owner, movementId, tx);
    if (!OPEN_STATES.includes(job.state)) fail('review_closed', 'La revisión ya está cerrada');
    const { data: config } = await this._read('review_configuration', owner, owner, tx, true);
    if (proposal.configuration_revision !== (config.revision || 0)) fail('configuration_conflict', 'La configuración cambió');
    const categories = await this._categories(owner, tx);
    const huchas = await this._owned('huchas', owner, tx);
    const subscriptions = await this._owned('suscripciones', owner, tx);
    const ids = proposal.new_subscription?.evidence_movement_ids ?? [];
    if (!Array.isArray(ids) || ids.length > 50) fail('invalid_evidence', 'Máximo 50 movimientos de evidencia');
    const evidenceSnapshots = await this._readAll('movimientos', ids, owner, tx);
    const complete = await this._processingComplete(owner, evidenceSnapshots.map((s) => s.data), tx);
    if (complete.includes(false)) fail('processing_incomplete', 'Un movimiento de evidencia aún está en procesamiento');
    const evidence = Object.fromEntries(evidenceSnapshots.map((s) => [s.id, s.data]));
    const evidenceVersions = Object.fromEntries(evidenceSnapshots.map((s) => [s.id, s.updateTime]));
    const plan = await planReview(owner, { ...movement, id: movementId }, { ...proposal, expected_version: movement.review_version || 0 },
      categories, huchas, config, subscriptions, evidence);
    return { plan, movement, huchas, subscriptions, evidence, evidenceVersions, jobId };
  }

  preview_review(owner, { movement_id, proposal }) {
    return this.db.runTransaction(async (tx) => plain((await this._prepare(owner, movement_id, proposal, tx)).plan));
  }

  _requireWrites() {
    if (!this.writesEnabled) fail('writes_disabled', 'Las escrituras de revisión están desactivadas');
  }

  async apply_review(owner, { movement_id, proposal }) {
    this._requireWrites();
    const operationId = checkedId(proposal.operation_id);
    const auditId = await documentId(owner, operationId);
    const digest = await sha256Hex(stableJson({ movement_id, proposal }));
    return this.db.runTransaction(async (tx) => {
      const auditRef = this._ref('review_history', auditId);
      const existing = await this.db.get(auditRef, tx);
      if (existing.exists) {
        if (existing.data[OWNER] !== owner || existing.data.request_digest !== digest) fail('operation_conflict', 'ID de operación reutilizado con otros datos');
        return existing.data.result;
      }
      const { plan, movement, huchas, subscriptions, evidence, evidenceVersions, jobId } = await this._prepare(owner, movement_id, proposal, tx);
      // All reads precede all writes. The transaction tracks versions of every effect.
      const changes = { ...plan.movement_changes };
      const updates = {};
      for (const [key, change] of Object.entries(plan.subscription_changes)) {
        updates[key] = { before: pick(key === movement_id ? movement : evidence[key], Object.keys(change)), after: { ...change } };
      }
      updates[movement_id] ||= { before: {}, after: {} };
      Object.assign(updates[movement_id].before, pick(movement, Object.keys(changes)));
      Object.assign(updates[movement_id].after, changes);
      const newSubscription = plan.new_subscription;
      if (newSubscription && subscriptions[newSubscription.id]) fail('subscription_conflict', 'La suscripción ya existe');
      const huchaEffects = Object.fromEntries(Object.entries(plan.hucha_changes).map(([key, change]) => [key, { before: pick(huchas[key], Object.keys(change)), after: change }]));
      for (const key of new Set([...Object.keys(plan.hucha_deltas), ...Object.keys(huchaEffects)])) {
        const update = { ...huchaEffects[key]?.after, updated_at: NOW };
        if (key in plan.hucha_deltas) update.saldo_acumulado = (cents(huchas[key].saldo_acumulado || 0) + plan.hucha_deltas[key]) / 100;
        tx.update(this._ref('huchas', key), update);
      }
      if (newSubscription) tx.create(this._ref('suscripciones', newSubscription.id), { ...newSubscription, [OWNER]: owner, created_at: NOW, updated_at: NOW });
      for (const [key, effect] of Object.entries(updates)) {
        const current = key === movement_id ? movement : evidence[key];
        const provenance = { ...(current.field_provenance || {}) };
        for (const field of Object.keys(effect.after)) provenance[field] = { source: 'automatic', review_id: auditId };
        tx.update(this._ref('movimientos', key), { ...effect.after, field_provenance: provenance, review_version: (current.review_version || 0) + 1, updated_at: NOW });
      }
      const result = { review_id: auditId, movement_id, state: 'reviewed', changes };
      tx.update(this._ref('review_jobs', jobId), { state: 'reviewed', review_id: auditId, updated_at: NOW });
      tx.create(auditRef, { [OWNER]: owner, movement_id, operation_id: operationId, request_digest: digest, effects: updates,
        hucha_deltas: plan.hucha_deltas, hucha_effects: huchaEffects,
        financial_guard: Object.fromEntries(GUARDED_FIELDS.map((field) => [field, updates[movement_id].after[field] ?? movement[field] ?? null])),
        created_subscription_id: newSubscription ? newSubscription.id : null, subscription_evidence: proposal.new_subscription ?? null,
        reason: proposal.reason || '', evidence: proposal.evidence || [], evidence_movement_versions: evidenceVersions,
        prompt_version: 'daily-review-v1', created_at: NOW, reverted: false, result });
      return result;
    });
  }

  async get_review_history(owner, { limit = 20, cursor = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('invalid_limit', 'Límite de historial no válido');
    const spec = { collection: 'review_history', where: [[OWNER, '==', owner]], orderBy: [['created_at', 'desc']], limit };
    if (cursor) spec.startAfter = (await this._read('review_history', cursor, owner)).snapshot;
    const rows = await this.db.query(spec);
    return plain({ items: rows.map((s) => ({ ...s.data, id: s.id })), next_cursor: rows.length === limit ? rows[rows.length - 1].id : null });
  }

  async revert_review(owner, { review_id }) {
    this._requireWrites();
    const conflict = (message) => fail('revert_conflict', message);
    return this.db.runTransaction(async (tx) => {
      const { data: audit } = await this._read('review_history', review_id, owner, tx);
      if (audit.reverted) return { review_id, reverted: true };
      const movementIds = Object.keys(audit.effects);
      const current = Object.fromEntries((await this._readAll('movimientos', movementIds, owner, tx)).map((s) => [s.id, s.data]));
      for (const [key, effect] of Object.entries(audit.effects)) {
        const movement = current[key];
        for (const [field, after] of Object.entries(effect.after)) {
          const provenance = (movement.field_provenance || {})[field] || {};
          if (!same(movement[field], after) || provenance.review_id !== review_id || (movement.review_protected_fields || []).includes(field)) {
            conflict('Hay cambios posteriores; no se puede deshacer automáticamente');
          }
        }
      }
      const deltas = audit.hucha_deltas || {};
      if (Object.keys(deltas).length) {
        const root = current[audit.movement_id];
        if (Object.entries(audit.financial_guard || {}).some(([field, value]) => !same(root[field], value))) conflict('Los datos financieros del movimiento cambiaron');
      }
      const huchaEffects = audit.hucha_effects || {};
      const huchaIds = [...new Set([...Object.keys(deltas), ...Object.keys(huchaEffects)])];
      const huchas = Object.fromEntries((await this._readAll('huchas', huchaIds, owner, tx)).map((s) => [s.id, s.data]));
      for (const key of Object.keys(deltas)) {
        const hucha = huchas[key];
        if (cents(hucha.deuda_pendiente || 0) || hucha.deuda_con || hucha.subsanar_con) conflict('La hucha tiene una deuda posterior; necesita revisión manual');
      }
      for (const [key, effect] of Object.entries(huchaEffects)) {
        if (Object.entries(effect.after).some(([field, value]) => !same(huchas[key][field], value))) conflict('La configuración financiera de la hucha cambió');
      }
      const subscriptionId = audit.created_subscription_id;
      if (subscriptionId) {
        // Never delete a subscription after another review or manual edit uses it.
        const { data: subscription } = await this._read('suscripciones', subscriptionId, owner, tx);
        const linked = await this.db.query({ collection: 'movimientos', where: [[OWNER, '==', owner], ['suscripcion_id', '==', subscriptionId]] }, tx);
        if (!same(subscription.updated_at, audit.created_at) || linked.some((s) => !(s.id in current))) conflict('La suscripción tiene cambios o vínculos posteriores');
      }
      for (const [key, effect] of Object.entries(audit.effects)) {
        const movement = current[key];
        const provenance = { ...(movement.field_provenance || {}) };
        for (const field of Object.keys(effect.after)) provenance[field] = { source: 'manual', reverted_review_id: review_id };
        tx.update(this._ref('movimientos', key), { ...restoring(effect.before),
          review_protected_fields: [...new Set([...(movement.review_protected_fields || []), ...Object.keys(effect.after)])].sort(),
          field_provenance: provenance, review_version: (movement.review_version || 0) + 1, updated_at: NOW });
      }
      for (const key of huchaIds) {
        const update = { ...restoring(huchaEffects[key]?.before || {}), updated_at: NOW };
        if (key in deltas) update.saldo_acumulado = (cents(huchas[key].saldo_acumulado || 0) - deltas[key]) / 100;
        tx.update(this._ref('huchas', key), update);
      }
      if (subscriptionId) tx.delete(this._ref('suscripciones', subscriptionId));
      tx.update(this._ref('review_history', review_id), { reverted: true, reverted_at: NOW, reverted_by: owner });
      return { review_id, reverted: true };
    });
  }

  /** Persist retries so a daily schedule cannot reset the retry budget. */
  async defer_review(owner, { movement_id, state, reason }) {
    this._requireWrites();
    if (!['waiting_evidence', 'retryable_error'].includes(state) || typeof reason !== 'string' || reason.length < 1 || reason.length > 1000) {
      fail('invalid_state', 'Estado de reintento no válido');
    }
    return this.db.runTransaction(async (tx) => {
      const { jobId, job } = await this._job(owner, movement_id, tx);
      if (job.state === 'reviewed') fail('review_closed', 'La revisión ya está cerrada');
      const attempts = (job.attempts || 0) + 1;
      const result = { state: attempts >= 3 ? 'needs_user_input' : state, attempts, last_error: reason,
        next_attempt_at: new Date(this.now().getTime() + Math.min(attempts, 3) * 86_400_000) };
      tx.update(this._ref('review_jobs', jobId), { ...result, updated_at: NOW });
      return plain(result);
    });
  }

  async record_question(owner, { question_id, movement_ids, question }) {
    this._requireWrites();
    if (typeof question !== 'string' || question.length < 1 || question.length > 2000 || !Array.isArray(movement_ids)
        || movement_ids.length < 1 || movement_ids.length > 20 || new Set(movement_ids).size !== movement_ids.length) {
      fail('invalid_question', 'Pregunta no válida');
    }
    const key = await documentId(owner, checkedId(question_id));
    return this.db.runTransaction(async (tx) => {
      const ref = this._ref('review_questions', key);
      const old = await this.db.get(ref, tx);
      if (old.exists) {
        if (old.data[OWNER] !== owner || old.data.question !== question || stableJson(old.data.movement_ids) !== stableJson(movement_ids)) {
          fail('question_conflict', 'ID de pregunta reutilizado');
        }
        return { question_id: key, state: old.data.state };
      }
      const jobs = await this._jobs(owner, movement_ids, tx);
      if (jobs.some(({ job }) => job.state === 'reviewed')) fail('review_closed', 'Una revisión ya está cerrada');
      tx.create(ref, { [OWNER]: owner, question, movement_ids, state: 'open', created_at: NOW });
      for (const { jobId } of jobs) tx.update(this._ref('review_jobs', jobId), { state: 'needs_user_input', question_id: key, updated_at: NOW });
      return { question_id: key, state: 'open' };
    });
  }

  async resolve_question(owner, { question_id, answer }) {
    this._requireWrites();
    if (typeof answer !== 'string' || answer.length < 1 || answer.length > 3000) fail('invalid_answer', 'Respuesta no válida');
    return this.db.runTransaction(async (tx) => {
      const { data: question } = await this._read('review_questions', question_id, owner, tx);
      if (question.state === 'resolved') {
        if (question.answer !== answer) fail('question_conflict', 'La pregunta ya tiene otra respuesta');
        return { question_id, state: 'resolved' };
      }
      const jobs = await this._jobs(owner, question.movement_ids, tx);
      for (const { jobId, job } of jobs) {
        if (job.question_id === question_id && job.state === 'needs_user_input') {
          tx.update(this._ref('review_jobs', jobId), { state: 'pending', attempts: 0, next_attempt_at: DELETE_FIELD, user_answer: answer, updated_at: NOW });
        }
      }
      tx.update(this._ref('review_questions', question_id), { state: 'resolved', answer, resolved_at: NOW });
      return { question_id, state: 'resolved' };
    });
  }

  async list_review_questions(owner) {
    const [questions, jobs] = await Promise.all([
      this.db.query({ collection: 'review_questions', where: [[OWNER, '==', owner], ['state', '==', 'open']], limit: 50 }),
      this.db.query({ collection: 'review_jobs', where: [[OWNER, '==', owner], ['state', '==', 'needs_user_input']], limit: 50 }),
    ]);
    return plain({ items: questions.map((s) => ({ ...s.data, id: s.id })),
      errors: jobs.filter((s) => !s.data.question_id).map((s) => ({ ...s.data, id: s.id })) });
  }

  /**
   * Human edits share the same balance planner as automatic reviews.
   *
   * They remain available when automatic writes are disabled: the web and a
   * connected assistant with write access act on the user's behalf.
   */
  edit_movement(owner, { movement_id, name = null, category = null, hucha_id = null }) {
    return this.db.runTransaction(async (tx) => {
      const { data: movement } = await this._read('movimientos', movement_id, owner, tx);
      const { data: config } = await this._read('review_configuration', owner, owner, tx, true);
      const huchas = await this._owned('huchas', owner, tx);
      const changes = {};
      const protectedFields = new Set(movement.review_protected_fields || []);
      if (name !== null) {
        if (typeof name !== 'string' || !name.trim() || name.length > 200) fail('invalid_name', 'Nombre no válido');
        changes.concepto = name.trim();
        protectedFields.add('concepto');
      }
      if (category !== null) {
        const categories = await this._categories(owner, tx);
        if (!categories.some((c) => c.id === category && [movement.tipo, 'ambos'].includes(c.tipo))) fail('invalid_category', 'Categoría no válida');
        changes.categoria = category;
        protectedFields.add('categoria');
      }
      let target = movement.hucha_id;
      if (hucha_id !== null) {
        target = checkedId(hucha_id);
        protectedFields.add('hucha_id');
      } else if (category !== null && !protectedFields.has('hucha_id') && movement.tipo === 'gasto') {
        target = (config.category_huchas || {})[category] || target;
      }
      let deltas = {};
      if ((target ?? null) !== (movement.hucha_id ?? null)) {
        if (movement.tipo !== 'gasto' || movement.es_interno || movement.es_metalico || movement.transfer_id) {
          fail('ineligible_movement', 'Este movimiento no admite reasignación de hucha');
        }
        activeHucha(owner, target, huchas);
        deltas = reassignment(owner, movement, target, huchas);
        changes.hucha_id = target;
      }
      if (!Object.keys(changes).length && hucha_id === null) fail('invalid_edit', 'No hay campos para editar');
      const provenance = { ...(movement.field_provenance || {}) };
      for (const field of Object.keys(changes)) provenance[field] = { source: protectedFields.has(field) ? 'manual' : 'automatic', source_detail: 'user_category_mapping' };
      for (const [key, delta] of Object.entries(deltas)) {
        tx.update(this._ref('huchas', key), { saldo_acumulado: (cents(huchas[key].saldo_acumulado || 0) + delta) / 100, updated_at: NOW });
      }
      tx.update(this._ref('movimientos', movement_id), { ...changes, review_protected_fields: [...protectedFields].sort(),
        field_provenance: provenance, review_version: (movement.review_version || 0) + 1, updated_at: NOW });
      return { movement_id, changes };
    });
  }
}
