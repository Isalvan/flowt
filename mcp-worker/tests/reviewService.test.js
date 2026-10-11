// @vitest-environment node
/** The review service and its financial planner against an atomic in-memory Firestore. */
import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceService } from '../src/financeService.js';
import { ReviewService } from '../src/reviewService.js';
import { documentId } from '../src/util.js';
import { MemoryDb } from './memoryDb.js';

const NOW = new Date('2026-10-10T12:00:00Z');
let db;
let service;
let proposal;
let jobId;

beforeEach(async () => {
  db = new MemoryDb();
  db.put('movimientos', 'movement', { id_propietario: 'owner', email_id: 'email', tipo: 'gasto', concepto: 'Bank charge', importe: 12,
    hucha_id: 'main', fecha_operacion: new Date('2026-10-03T00:00:00Z'), review_version: 0, moneda: 'EUR' });
  db.put('huchas', 'main', { id_propietario: 'owner', saldo_acumulado: 100, es_principal: true });
  db.put('huchas', 'food', { id_propietario: 'owner', saldo_acumulado: 50 });
  db.put('categorias/owner/items', 'custom-food', { nombre: 'Food', tipo: 'gasto' });
  db.put('review_configuration', 'owner', { revision: 1, category_huchas: { 'custom-food': 'food' } });
  db.put('email_processing', 'receipt', { id_propietario: 'owner', state: 'completed', movement_ids: ['movement'] });
  jobId = await documentId('owner', 'movement');
  db.put('review_jobs', jobId, { id_propietario: 'owner', movement_id: 'movement', processing_id: 'receipt', state: 'pending' });
  service = new ReviewService(db, { writesEnabled: true, now: () => NOW });
  proposal = { operation_id: 'operation', expected_version: db.versions.get('movimientos/movement'), configuration_revision: 1,
    reason: 'Receipt identifies purchase', name: 'Groceries', category: 'custom-food' };
});

const apply = (owner = 'owner', given = proposal) => service.apply_review(owner, { movement_id: 'movement', proposal: given });

/** The call fails with `code` and leaves every document untouched. */
async function refused(code, call) {
  const before = db.snapshotAll();
  const writes = db.committedWrites;
  await expect(call()).rejects.toMatchObject({ code });
  expect(db.snapshotAll()).toEqual(before);
  expect(db.committedWrites).toBe(writes);
}

function subscriptionProposal() {
  const base = db.read('movimientos', 'movement');
  db.put('movimientos', 'july', { ...base, fecha_operacion: new Date('2026-07-15T00:00:00Z') });
  db.put('movimientos', 'august', { ...base, fecha_operacion: new Date('2026-08-15T00:00:00Z') });
  // Dates/amounts may vary: only consecutive calendar months are mandatory.
  db.patch('movimientos', 'movement', { fecha_operacion: new Date('2026-09-20T00:00:00Z') });
  return { ...proposal, new_subscription: { name: 'Membership', amount: 12, frequency: 'monthly', day: 15, anchor_date: '2026-07-15',
    evidence_movement_ids: ['july', 'august', 'movement'], reason: 'Three consecutive membership payments' } };
}

function systemSubscriptionSetup() {
  db.patch('review_configuration', 'owner', { category_huchas: {} });
  db.put('huchas', 'system', { id_propietario: 'owner', es_suscripciones: true, saldo_acumulado: 80, objetivo: 10, valor_aportacion: 10,
    tipo_aportacion: 'flat', tope_objetivo: false });
  db.put('suscripciones', 'existing-yearly', { id_propietario: 'owner', importe: 120, frecuencia: 'anual', hucha_id: 'system', activa: true });
  return subscriptionProposal();
}

describe('applying a review', () => {
  it('previews the real financial plan without writing', async () => {
    const before = db.snapshotAll();
    const plan = await service.preview_review('owner', { movement_id: 'movement', proposal });
    expect(plan.movement_changes.hucha_id).toBe('food');
    expect(plan.hucha_deltas).toEqual({ main: 1200, food: -1200 });
    expect(db.snapshotAll()).toEqual(before);
    expect(db.committedWrites).toBe(0);
  });

  it('returns the original result on retry without duplicate effects', async () => {
    const first = await apply();
    const before = db.snapshotAll();
    const writes = db.committedWrites;
    expect(await apply()).toEqual(first);
    expect(db.snapshotAll()).toEqual(before);
    expect(db.committedWrites).toBe(writes);
    expect(db.read('huchas', 'main').saldo_acumulado).toBe(112);
    expect(db.read('huchas', 'food').saldo_acumulado).toBe(38);
    expect(db.read('movimientos', 'movement')).toMatchObject({ review_version: 1, concepto: 'Groceries', categoria: 'custom-food', hucha_id: 'food' });
    expect(db.read('review_jobs', jobId)).toMatchObject({ state: 'reviewed', review_id: first.review_id });
    // The same request with its keys in another order is still the same request.
    const reordered = Object.fromEntries(Object.entries(proposal).reverse());
    expect(await apply('owner', reordered)).toEqual(first);
  });

  it('treats a reused operation id with another payload as a conflict', async () => {
    await apply();
    await refused('operation_conflict', () => apply('owner', { ...proposal, name: 'Different purchase' }));
  });

  it('hides another user\'s movement', async () => {
    await refused('not_found', () => apply('other'));
  });

  it('waits for the email to finish processing', async () => {
    db.patch('email_processing', 'receipt', { state: 'processing' });
    await refused('processing_incomplete', () => apply());
  });

  it('detects a concurrent manual edit through the document version', async () => {
    db.put('movimientos', 'movement', { ...db.read('movimientos', 'movement'), concepto: 'Manual choice' });
    await refused('version_conflict', () => apply());
  });

  it('detects a configuration change', async () => {
    db.patch('review_configuration', 'owner', { revision: 2 });
    await refused('configuration_conflict', () => apply());
  });

  it('does nothing while automatic writes are switched off', async () => {
    service.writesEnabled = false;
    await refused('writes_disabled', () => apply());
    await refused('writes_disabled', () => service.revert_review('owner', { review_id: 'x' }));
  });

  it('waits for the processing receipt of related evidence', async () => {
    const movement = db.read('movimientos', 'movement');
    const processingId = await documentId('owner', 'email');
    db.put('email_processing', processingId, { id_propietario: 'owner', state: 'processing' });
    expect(await service._processingComplete('owner', [movement])).toEqual([false]);
    db.put('email_processing', processingId, { id_propietario: 'owner', state: 'completed' });
    expect(await service._processingComplete('owner', [movement, { concepto: 'manual' }])).toEqual([true, true]);
  });
});

describe('reverting a review', () => {
  it('restores fields and applies the inverse to current balances', async () => {
    const result = await apply();
    // Subsequent unrelated income must survive undo.
    db.patch('huchas', 'main', { saldo_acumulado: db.read('huchas', 'main').saldo_acumulado + 30 });
    expect((await service.revert_review('owner', { review_id: result.review_id })).reverted).toBe(true);
    const movement = db.read('movimientos', 'movement');
    expect(movement).toMatchObject({ concepto: 'Bank charge', hucha_id: 'main', review_protected_fields: ['categoria', 'concepto', 'hucha_id'] });
    expect(movement).not.toHaveProperty('categoria');
    expect(db.read('huchas', 'main').saldo_acumulado).toBe(130);
    expect(db.read('huchas', 'food').saldo_acumulado).toBe(50);
    const before = db.snapshotAll();
    await service.revert_review('owner', { review_id: result.review_id });
    expect(db.snapshotAll()).toEqual(before);
  });

  it('rejects a later manual field change without a partial refund', async () => {
    const result = await apply();
    db.patch('movimientos', 'movement', { concepto: 'Later edit' });
    await refused('revert_conflict', () => service.revert_review('owner', { review_id: result.review_id }));
  });

  it('rejects when the amount changed after the review', async () => {
    const result = await apply();
    db.patch('movimientos', 'movement', { importe: 20 });
    await refused('revert_conflict', () => service.revert_review('owner', { review_id: result.review_id }));
  });

  it.each([{ deuda_pendiente: 5 }, { deuda_con: 'other' }, { subsanar_con: 'other' }])('rejects debt introduced after the review (%o)', async (debt) => {
    const result = await apply();
    db.patch('huchas', 'food', debt);
    await refused('revert_conflict', () => service.revert_review('owner', { review_id: result.review_id }));
  });

  it('is blocked by a manual edit made afterwards, even to the same value', async () => {
    const result = await apply();
    await service.edit_movement('owner', { movement_id: 'movement', name: 'Groceries' });
    await refused('revert_conflict', () => service.revert_review('owner', { review_id: result.review_id }));
  });
});

describe('subscriptions created by a review', () => {
  it('links all real evidence and can be reverted', async () => {
    const result = await apply('owner', subscriptionProposal());
    const sid = db.read('movimientos', 'movement').suscripcion_id;
    expect(db.read('suscripciones', sid)).toMatchObject({ nombre: 'Membership', id_propietario: 'owner', frecuencia: 'mensual' });
    for (const id of ['july', 'august', 'movement']) expect(db.read('movimientos', id).suscripcion_id).toBe(sid);
    await service.revert_review('owner', { review_id: result.review_id });
    expect(db.read('suscripciones', sid)).toBeNull();
    for (const id of ['july', 'august', 'movement']) expect(db.read('movimientos', id)).not.toHaveProperty('suscripcion_id');
  });

  it('rejects foreign evidence before any write', async () => {
    const given = subscriptionProposal();
    db.patch('movimientos', 'july', { id_propietario: 'other' });
    await refused('not_found', () => apply('owner', given));
  });

  it('keeps a subscription that gained a later link', async () => {
    const result = await apply('owner', subscriptionProposal());
    const sid = db.read('movimientos', 'movement').suscripcion_id;
    db.put('movimientos', 'later', { ...db.read('movimientos', 'movement'), suscripcion_id: sid });
    await refused('revert_conflict', () => service.revert_review('owner', { review_id: result.review_id }));
  });

  it('keeps a subscription the user edited later', async () => {
    const result = await apply('owner', subscriptionProposal());
    const sid = db.read('movimientos', 'movement').suscripcion_id;
    db.put('suscripciones', sid, { ...db.read('suscripciones', sid), nombre: 'User edited', updated_at: db.tick() });
    await refused('revert_conflict', () => service.revert_review('owner', { review_id: result.review_id }));
  });

  it('updates the system wallet target and undoes only its own effects', async () => {
    const result = await apply('owner', systemSubscriptionSetup());
    expect(db.read('huchas', 'system')).toMatchObject({ objetivo: 22, valor_aportacion: 22, saldo_acumulado: 68 });
    db.patch('huchas', 'system', { saldo_acumulado: 75 });
    await service.revert_review('owner', { review_id: result.review_id });
    expect(db.read('huchas', 'system')).toMatchObject({ objetivo: 10, valor_aportacion: 10, saldo_acumulado: 87 });
    expect(db.read('suscripciones', 'existing-yearly')).not.toBeNull();
  });

  it('is blocked by a later edit of the system wallet target', async () => {
    const result = await apply('owner', systemSubscriptionSetup());
    db.patch('huchas', 'system', { objetivo: 99 });
    await refused('revert_conflict', () => service.revert_review('owner', { review_id: result.review_id }));
  });
});

describe('questions and retries', () => {
  async function seedSecondJob() {
    db.put('movimientos', 'second', db.read('movimientos', 'movement'));
    db.patch('email_processing', 'receipt', { movement_ids: ['movement', 'second'] });
    db.put('review_jobs', await documentId('owner', 'second'), { id_propietario: 'owner', movement_id: 'second', processing_id: 'receipt',
      state: 'retryable_error', attempts: 2, next_attempt_at: db.tick() });
  }
  const job = async (movementId) => db.read('review_jobs', await documentId('owner', movementId));

  it('records and answers a grouped question atomically and idempotently', async () => {
    await seedSecondJob();
    const ask = () => service.record_question('owner', { question_id: 'question', movement_ids: ['movement', 'second'], question: 'Which category applies?' });
    const recorded = await ask();
    expect(recorded.state).toBe('open');
    for (const id of ['movement', 'second']) expect(await job(id)).toMatchObject({ state: 'needs_user_input', question_id: recorded.question_id });
    let before = db.snapshotAll();
    let writes = db.committedWrites;
    expect(await ask()).toEqual(recorded);
    expect(db.snapshotAll()).toEqual(before);
    expect(db.committedWrites).toBe(writes);
    expect((await service.list_review_questions('owner')).items[0].id).toBe(recorded.question_id);
    const answer = () => service.resolve_question('owner', { question_id: recorded.question_id, answer: 'Use food for both' });
    const resolved = await answer();
    expect(resolved.state).toBe('resolved');
    for (const id of ['movement', 'second']) {
      expect(await job(id)).toMatchObject({ state: 'pending', attempts: 0, user_answer: 'Use food for both' });
      expect(await job(id)).not.toHaveProperty('next_attempt_at');
    }
    before = db.snapshotAll();
    writes = db.committedWrites;
    expect(await answer()).toEqual(resolved);
    expect(db.snapshotAll()).toEqual(before);
    expect(db.committedWrites).toBe(writes);
    expect((await service.list_review_questions('owner')).items).toEqual([]);
  });

  it('refuses a reused question id or a different answer without writing', async () => {
    const question = await service.record_question('owner', { question_id: 'question', movement_ids: ['movement'], question: 'Choose category' });
    await refused('question_conflict', () => service.record_question('owner', { question_id: 'question', movement_ids: ['movement'], question: 'Changed question' }));
    await service.resolve_question('owner', { question_id: question.question_id, answer: 'Food' });
    await refused('question_conflict', () => service.resolve_question('owner', { question_id: question.question_id, answer: 'Other' }));
  });

  it('changes no job when one of the grouped movements is invalid', async () => {
    await refused('not_found', () => service.record_question('owner', { question_id: 'question', movement_ids: ['movement', 'missing'], question: 'Choose category' }));
  });

  it('keeps the retry budget across service instances and escalates after three attempts', async () => {
    for (const attempt of [1, 2, 3]) {
      // A scheduled run constructs a fresh service, without resetting storage.
      const next = new ReviewService(db, { writesEnabled: true, now: () => NOW });
      const result = await next.defer_review('owner', { movement_id: 'movement', state: 'waiting_evidence', reason: 'Receipt unavailable' });
      expect(result).toMatchObject({ attempts: attempt, state: attempt === 3 ? 'needs_user_input' : 'waiting_evidence' });
    }
    expect(await job('movement')).toMatchObject({ attempts: 3, last_error: 'Receipt unavailable' });
    expect((await job('movement')).next_attempt_at).toEqual(new Date(NOW.getTime() + 3 * 86_400_000));
    const listed = await service.list_review_questions('owner');
    expect(listed.errors.map((e) => e.movement_id)).toEqual(['movement']);
  });
});

describe('reading the queue and context', () => {
  it('lists due jobs of completed emails only, page by page', async () => {
    db.put('movimientos', 'second', db.read('movimientos', 'movement'));
    db.put('movimientos', 'later', db.read('movimientos', 'movement'));
    db.put('movimientos', 'unfinished', db.read('movimientos', 'movement'));
    db.patch('email_processing', 'receipt', { movement_ids: ['movement', 'second', 'later'] });
    db.put('email_processing', 'open', { id_propietario: 'owner', state: 'processing', movement_ids: ['unfinished'] });
    const seed = async (id, extra) => db.put('review_jobs', await documentId('owner', id), { id_propietario: 'owner', movement_id: id, processing_id: 'receipt', state: 'pending', ...extra });
    await seed('second', { state: 'waiting_evidence' });
    await seed('later', { next_attempt_at: new Date(NOW.getTime() + 60_000) });
    await seed('unfinished', { processing_id: 'open' });
    db.put('review_jobs', await documentId('other', 'theirs'), { id_propietario: 'other', movement_id: 'theirs', processing_id: 'receipt', state: 'pending' });
    const all = await service.list_pending_reviews('owner', { limit: 50 });
    expect(all.items.map((i) => i.movement_id).sort()).toEqual(['movement', 'second']);
    expect(all.next_cursor).toBeNull();
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 6; page += 1) {
      const result = await service.list_pending_reviews('owner', { limit: 1, ...(cursor ? { cursor } : {}) });
      seen.push(...result.items.map((i) => i.movement_id));
      cursor = result.next_cursor;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual(['movement', 'second']);
    await expect(service.list_pending_reviews('owner', { limit: 51 })).rejects.toMatchObject({ code: 'invalid_limit' });
  });

  it('gives the movement, its exact version, its job and its email', async () => {
    db.put('correos_historico', 'email', { id_propietario: 'owner', cuerpo: 'Cargo en tarjeta' });
    const context = await service.get_movement_context('owner', { movement_id: 'movement' });
    expect(context).toMatchObject({ version: proposal.expected_version, job_id: jobId, email_id: 'email', email: { cuerpo: 'Cargo en tarjeta' } });
    expect(context.movement).toMatchObject({ id: 'movement', concepto: 'Bank charge', fecha_operacion: '2026-10-03T00:00:00.000Z' });
    await expect(service.get_movement_context('other', { movement_id: 'movement' })).rejects.toMatchObject({ code: 'not_found' });
    const configuration = await service.get_finance_configuration('owner');
    expect(configuration.configuration.revision).toBe(1);
    expect(configuration.huchas.map((h) => h.id).sort()).toEqual(['food', 'main']);
    expect(configuration.categories).toContainEqual({ nombre: 'Food', tipo: 'gasto', id: 'custom-food' });
  });

  it('searches history by date, skipping movements whose email is still processing', async () => {
    db.put('movimientos', 'old', { ...db.read('movimientos', 'movement'), email_id: 'other-email', fecha_operacion: new Date('2026-09-03T00:00:00Z') });
    db.put('movimientos', 'busy', { ...db.read('movimientos', 'movement'), email_id: 'busy-email', fecha_operacion: new Date('2026-09-10T00:00:00Z') });
    db.put('email_processing', await documentId('owner', 'busy-email'), { id_propietario: 'owner', state: 'processing' });
    const search = (extra = {}) => service.search_related_movements('owner', { start_date: '2026-09-01T00:00:00+02:00', end_date: '2026-11-01T00:00:00+01:00', ...extra });
    expect((await search()).items.map((m) => m.id)).toEqual(['old', 'movement']);
    const first = await search({ limit: 1 });
    expect(first.items.map((m) => m.id)).toEqual(['old']);
    expect((await search({ limit: 2, cursor: first.next_cursor })).items.map((m) => m.id)).toEqual(['movement']);
    expect((await search()).items[1].version).toBe(proposal.expected_version);
    await expect(search({ start_date: '2026-09-01' })).rejects.toMatchObject({ code: 'invalid_dates' });
  });

  it('pages the history of reviews, newest first', async () => {
    const result = await apply();
    const history = await service.get_review_history('owner', { limit: 10 });
    expect(history.items.map((i) => i.id)).toEqual([result.review_id]);
    expect(history.items[0]).toMatchObject({ movement_id: 'movement', reverted: false, reason: 'Receipt identifies purchase' });
    expect((await service.get_review_history('other')).items).toEqual([]);
  });
});

describe('manual edits', () => {
  it('override automatic fields even while automatic writes are off', async () => {
    await apply();
    service.writesEnabled = false;
    const result = await service.edit_movement('owner', { movement_id: 'movement', name: 'User chosen name', category: 'custom-food' });
    expect(result.changes.concepto).toBe('User chosen name');
    const movement = db.read('movimientos', 'movement');
    expect(movement.review_protected_fields).toEqual(expect.arrayContaining(['concepto', 'categoria']));
    expect(movement.field_provenance).toMatchObject({ concepto: { source: 'manual' }, categoria: { source: 'manual' } });
    expect(movement.review_version).toBe(2);
  });

  it('move the gross amount by the category mapping and leave stats and compensations alone', async () => {
    db.patch('movimientos', 'movement', { importe_compensado: 5, compensaciones: [{ movimiento_id: 'income', importe: 5 }] });
    db.put('stats', 'owner', { id_propietario: 'owner', total_ingresos: 100, total_gastos: 12 });
    const stats = db.read('stats', 'owner');
    await service.edit_movement('owner', { movement_id: 'movement', category: 'custom-food' });
    const updated = db.read('movimientos', 'movement');
    expect(updated).toMatchObject({ categoria: 'custom-food', hucha_id: 'food', importe_compensado: 5, compensaciones: [{ movimiento_id: 'income', importe: 5 }] });
    expect(db.read('huchas', 'main').saldo_acumulado).toBe(112);
    expect(db.read('huchas', 'food').saldo_acumulado).toBe(38);
    expect(db.read('stats', 'owner')).toEqual(stats);
    expect(updated.field_provenance.hucha_id.source).toBe('automatic');
    expect(updated.review_protected_fields).not.toContain('hucha_id');
  });

  it('keep a wallet the user chose when the category changes later', async () => {
    await service.edit_movement('owner', { movement_id: 'movement', hucha_id: 'main' });
    const before = [db.read('huchas', 'main'), db.read('huchas', 'food')];
    await service.edit_movement('owner', { movement_id: 'movement', category: 'custom-food' });
    expect(db.read('movimientos', 'movement')).toMatchObject({ categoria: 'custom-food', hucha_id: 'main' });
    expect(db.read('movimientos', 'movement').review_protected_fields).toContain('hucha_id');
    expect([db.read('huchas', 'main'), db.read('huchas', 'food')]).toEqual(before);
  });

  it('do not repeat the financial effect when the same wallet is chosen again', async () => {
    await service.edit_movement('owner', { movement_id: 'movement', hucha_id: 'food' });
    const before = [db.read('huchas', 'main'), db.read('huchas', 'food')];
    await service.edit_movement('owner', { movement_id: 'movement', hucha_id: 'food' });
    expect(db.read('movimientos', 'movement').hucha_id).toBe('food');
    expect([db.read('huchas', 'main'), db.read('huchas', 'food')]).toEqual(before);
  });

  it.each([['other', 'custom-food', 'not_found'], ['owner', 'missing-category', 'invalid_category']])(
    'write nothing for a foreign owner or an unknown category (%s, %s)', async (owner, category, code) => {
      await refused(code, () => service.edit_movement(owner, { movement_id: 'movement', category }));
      expect(db.committedWrites).toBe(0);
    });

  it('reach the assistant as update_movement, with the same protection', async () => {
    const finance = new FinanceService(db, { reviews: service, now: () => NOW });
    await finance.update_movement('owner', { movement_id: 'movement', name: 'Cine', category: 'custom-food' });
    expect(db.read('movimientos', 'movement')).toMatchObject({ concepto: 'Cine', categoria: 'custom-food', hucha_id: 'food' });
    expect(db.read('huchas', 'food').saldo_acumulado).toBe(38);
  });
});
