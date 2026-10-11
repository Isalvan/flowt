// @vitest-environment node
/** Financial invariants and authority boundaries of automatic reviews. */
import { describe, expect, it } from 'vitest';
import { planReview } from '../src/reviewDomain.js';

function fixture() {
  const movement = { id: 'm', id_propietario: 'u', tipo: 'gasto', concepto: 'Compra', importe: 30, hucha_id: 'old', fecha_operacion: '2026-03-02', review_version: 2 };
  const proposal = { name: 'Pedido', category: 'food', reason: 'Recibo del comercio', expected_version: 2, configuration_revision: 1, operation_id: 'op' };
  const categories = [{ id: 'food', tipo: 'gasto', label: 'Comida' }];
  const huchas = Object.fromEntries(['old', 'new', 'rest'].map((id) => [id, { id_propietario: 'u', saldo_acumulado: 50, activa: true }]));
  huchas.rest.tipo_aportacion = 'resto';
  return [movement, proposal, categories, huchas, { revision: 1, category_huchas: { food: 'new' } }, {}, {}];
}
const plan = (args) => planReview('u', ...args);
const expectError = async (args, code) => expect(plan(args)).rejects.toMatchObject({ code });

function subscriptionFixture() {
  const args = fixture();
  args[1].new_subscription = { name: 'Servicio', amount: 19.25, frequency: 'monthly', day: 7, anchor_date: '2026-01-07',
    reason: 'Facturas mensuales del servicio', evidence_movement_ids: ['a', 'b', 'm'] };
  args[6] = {
    a: { id_propietario: 'u', tipo: 'gasto', importe: 10, fecha_operacion: '2025-12-31T23:15:00Z' },
    b: { id_propietario: 'u', tipo: 'gasto', importe: 15, fecha_operacion: '2026-02-05' },
    m: args[0],
  };
  return args;
}

describe('reassignment', () => {
  it('uses the gross amount and leaves compensations and inputs alone', async () => {
    const args = fixture();
    Object.assign(args[0], { importe_neto: 10, compensado_por: ['income'] });
    const result = await plan(args);
    expect(result.hucha_deltas).toEqual({ new: -3000, old: 3000 });
    expect(result.movement_changes).toEqual({ concepto: 'Pedido', categoria: 'food', hucha_id: 'new' });
    expect(args[0].concepto).toBe('Compra');
    expect(args[0].compensado_por).toEqual(['income']);
  });

  it('redirects what a capped wallet cannot take back, without losing money', async () => {
    const args = fixture();
    Object.assign(args[3].old, { tope_objetivo: true, objetivo: 60 });
    expect((await plan(args)).hucha_deltas).toEqual({ new: -3000, old: 1000, rest: 2000 });
    Object.assign(args[3].rest, { tope_objetivo: true, objetivo: 50 });
    await expectError(args, 'unallocated_overflow');
  });

  it('accounts for the room the charge itself opens in the destination', async () => {
    const args = fixture();
    Object.assign(args[3].old, { tope_objetivo: true, objetivo: 50 });
    delete args[3].rest.tipo_aportacion;
    Object.assign(args[3].new, { tope_objetivo: true, objetivo: 50, tipo_aportacion: 'resto' });
    const result = await plan(args);
    expect(result.hucha_deltas).toEqual({});
    expect(result.movement_changes.hucha_id).toBe('new');
  });

  it.each([['deuda_pendiente', 10, 'unsupported_debt'], ['activa', false, 'invalid_hucha'], ['id_propietario', 'other', 'forbidden']])(
    'rejects an invalid destination (%s)', async (field, value, code) => {
      const args = fixture();
      args[3].new[field] = value;
      await expectError(args, code);
    });

  it('never redistributes money when classifying an income', async () => {
    const args = fixture();
    args[0].tipo = 'ingreso';
    args[2][0].tipo = 'ingreso';
    expect((await plan(args)).hucha_deltas).toEqual({});
  });
});

describe('proposal authority', () => {
  it.each([['importe', 20, 'forbidden_fields'], ['expected_version', 1, 'version_conflict'], ['configuration_revision', 0, 'configuration_conflict']])(
    'rejects stale or forbidden proposals (%s)', async (field, value, code) => {
      const args = fixture();
      args[1][field] = value;
      await expectError(args, code);
    });

  it('respects manual locks and legacy confirmed categories', async () => {
    const args = fixture();
    args[0].review_protected_fields = ['hucha_id'];
    expect((await plan(args)).hucha_deltas).toEqual({});
    args[0].categoria = 'old_category';
    await expectError(args, 'manual_field');
    args[0].field_provenance = { categoria: { source: 'automatic' } };
    expect((await plan(args)).movement_changes.categoria).toBe('food');
    args[0].review_protected_fields.push('concepto');
    await expectError(args, 'manual_field');
  });
});

describe('subscriptions', () => {
  it('counts months in Madrid and allows varying days and amounts', async () => {
    const args = subscriptionFixture();
    const result = await plan(args);
    const sub = result.new_subscription;
    expect(sub).toMatchObject({ frecuencia: 'mensual', importe: 19.25, fecha_inicio: '2026-01-07' });
    expect(result.subscription_changes).toEqual({ a: { suscripcion_id: sub.id }, b: { suscripcion_id: sub.id }, m: { suscripcion_id: sub.id } });
    expect((await plan(args)).new_subscription.id).toBe(sub.id);
  });

  it.each([
    ['duplicate', 'invalid_evidence'], ['gap', 'insufficient_months'], ['foreign', 'forbidden'], ['linked', 'subscription_conflict'],
    ['internal', 'invalid_evidence'], ['currency', 'currency_conflict'], ['annual', 'invalid_frequency'],
  ])('validates the evidence structurally (%s)', async (mutation, code) => {
    const args = subscriptionFixture();
    if (mutation === 'duplicate') args[1].new_subscription.evidence_movement_ids = ['a', 'a', 'b'];
    else if (mutation === 'gap') args[6].m.fecha_operacion = '2026-04-07';
    else if (mutation === 'foreign') args[6].a.id_propietario = 'other';
    else if (mutation === 'linked') args[6].a.suscripcion_id = 'existing';
    else if (mutation === 'internal') args[6].a.es_interno = true;
    else if (mutation === 'currency') args[6].a.moneda = 'USD';
    else args[1].new_subscription.frequency = 'annual';
    await expectError(args, code);
  });

  it('prefers the category wallet over the subscription wallet and never edits the schedule', async () => {
    const args = fixture();
    args[1].subscription_id = 's';
    args[5].s = { id_propietario: 'u', hucha_id: 'rest', importe: 80, dia_pago: 10, frecuencia: 'anual' };
    expect((await plan(args)).movement_changes.hucha_id).toBe('new');
    args[4].category_huchas = {};
    const result = await plan(args);
    expect(result.movement_changes.hucha_id).toBe('rest');
    expect(result.subscription_changes).toEqual({});
    expect(args[5].s.importe).toBe(80);
  });

  it('picks the wallet of a new subscription and keeps the system budget in step', async () => {
    const args = subscriptionFixture();
    args[3].rest.es_suscripciones = true;
    let result = await plan(args);
    expect(result.new_subscription.hucha_id).toBe('new');
    expect(result.hucha_changes).toEqual({});
    args[4].category_huchas = {};
    args[5] = {
      annual: { id_propietario: 'u', frecuencia: 'anual', importe: 120, activa: true },
      shared: { id_propietario: 'u', frecuencia: 'mensual', importe: 20, mi_parte: 5, activa: true },
      outside: { id_propietario: 'u', frecuencia: 'mensual', importe: 99, hucha_id: 'old', activa: true },
    };
    result = await plan(args);
    expect(result.new_subscription.hucha_id).toBe('rest');
    expect(result.movement_changes.hucha_id).toBe('rest');
    expect(result.hucha_changes.rest.valor_aportacion).toBe(34.25);
    delete args[3].rest.es_suscripciones;
    result = await plan(args);
    expect(result.new_subscription.hucha_id).toBe('old');
    expect(result.hucha_changes).toEqual({});
  });

  it('requires the reviewed movement among the evidence and a supported currency', async () => {
    let args = subscriptionFixture();
    args[1].new_subscription.evidence_movement_ids[2] = 'other';
    await expectError(args, 'invalid_evidence');
    args = subscriptionFixture();
    args[0].moneda = 'USD';
    await expectError(args, 'unsupported_currency');
  });
});
