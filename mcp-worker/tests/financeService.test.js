// @vitest-environment node
/** The finance tools end to end against an atomic in-memory Firestore. */
import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceService } from '../src/financeService.js';
import { MemoryDb } from './memoryDb.js';

const NOW = new Date('2026-10-10T12:00:00Z');
let db;
let service;

beforeEach(() => {
  db = new MemoryDb();
  db.put('huchas', 'main', { id_propietario: 'owner', nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 1000, orden: 1, activa: true });
  db.put('huchas', 'trip', { id_propietario: 'owner', nombre: 'Viaje', tipo_aportacion: 'porcentaje', valor_aportacion: 10, saldo_acumulado: 200, objetivo: 250, tope_objetivo: true, orden: 2, activa: true });
  db.put('huchas', 'fixed', { id_propietario: 'owner', nombre: 'Fijos', tipo_aportacion: 'flat', valor_aportacion: 100, saldo_acumulado: 0, orden: 3, activa: true });
  db.put('huchas', 'theirs', { id_propietario: 'other', nombre: 'Ajena', tipo_aportacion: 'resto', saldo_acumulado: 500, orden: 1 });
  db.put('movimientos', 'theirs', { id_propietario: 'other', tipo: 'gasto', concepto: 'Ajeno', importe: 5, hucha_id: 'theirs', fecha_operacion: NOW });
  db.put('stats', 'owner', { total_ingresos: 5000, total_gastos: 3000 });
  service = new FinanceService(db, { now: () => NOW });
});

const balances = (owner = 'owner') => Object.fromEntries(Object.entries(db.all('huchas')).filter(([, h]) => h.id_propietario === owner).map(([id, h]) => [id, h.saldo_acumulado]));

/** The call fails with `code` and leaves every document untouched. */
async function refused(code, call) {
  const before = db.snapshotAll();
  const writes = db.committedWrites;
  await expect(call()).rejects.toMatchObject({ code });
  expect(db.snapshotAll()).toEqual(before);
  expect(db.committedWrites).toBe(writes);
}

const expense = (overrides = {}) => service.create_movement('owner', { tipo: 'gasto', concepto: 'Mercadona', importe: 84.5, fecha_operacion: NOW.toISOString(), ...overrides });

describe('payroll extras', () => {
  const configure = () => db.put('huchas', 'fixed', { ...db.read('huchas', 'fixed'), extra_importe: 100, extra_meses: [8, 12] });
  const payroll = (overrides = {}) => service.create_movement('owner', { tipo: 'ingreso', concepto: 'Nómina', importe: 1000, fecha_operacion: '2026-08-01', ...overrides });

  it('applies once, records the month, and deletion permits reapplication', async () => {
    configure();
    const first = await payroll();
    expect(db.read('huchas', 'fixed')).toMatchObject({ extra_ultimo: '2026-08', saldo_acumulado: 200 });
    expect(first.movement.reparto_aplicado.extras).toEqual({ fixed: '2026-08' });
    expect((await payroll()).movement.reparto_aplicado).not.toHaveProperty('extras');
    await service.delete_movement('owner', { movement_id: first.movement.id });
    expect(db.read('huchas', 'fixed')).not.toHaveProperty('extra_ultimo');
    expect((await payroll()).movement.reparto_aplicado.extras).toEqual({ fixed: '2026-08' });
  });

  it('preserves a newer extra month when deleting an older payroll', async () => {
    configure();
    const first = await payroll();
    await payroll({ fecha_operacion: '2026-12-01' });
    await service.delete_movement('owner', { movement_id: first.movement.id });
    expect(db.read('huchas', 'fixed').extra_ultimo).toBe('2026-12');
  });

  it.each([{ concepto: 'Regalo' }, { hucha_id: 'fixed' }])('does not apply to non payroll or directed income: %j', async overrides => {
    configure();
    await payroll(overrides);
    expect(db.read('huchas', 'fixed')).not.toHaveProperty('extra_ultimo');
  });

  it('applies when approving pending payroll and clears it on deletion', async () => {
    configure();
    db.put('correos_pendientes', 'pending', { id_propietario: 'owner', email_id: 'mail' });
    const created = await service.approve_pending_email('owner', { email_id: 'pending', tipo: 'ingreso', concepto: 'Nómina', importe: 1000, fecha_operacion: '2026-08-01' });
    expect(db.read('huchas', 'fixed').extra_ultimo).toBe('2026-08');
    await service.delete_movement('owner', { movement_id: created.movement.id });
    expect(db.read('huchas', 'fixed')).not.toHaveProperty('extra_ultimo');
  });

  it.each([false, true])('conversion applies only automatic extras, reversal clears them: manual=%s', async manual => {
    configure();
    const created = await expense({ concepto: 'Nómina', importe: 1000, fecha_operacion: '2026-08-01', hucha_id: 'main' });
    await service.convert_movement('owner', { movement_id: created.movement.id, ...(manual ? { distribution: [{ hucha_id: 'fixed', importe: 1000 }] } : {}) });
    expect(db.read('huchas', 'fixed').extra_ultimo).toBe(manual ? undefined : '2026-08');
    await service.convert_movement('owner', { movement_id: created.movement.id, target_hucha_id: 'main' });
    expect(db.read('huchas', 'fixed')).not.toHaveProperty('extra_ultimo');
  });
});

describe('movements', () => {
  it('charges the chosen wallet and protects what the user chose', async () => {
    const result = await expense({ hucha_id: 'trip', categoria: 'alimentacion' });
    const stored = db.read('movimientos', result.movement.id);
    expect(balances()).toEqual({ main: 1000, trip: 115.5, fixed: 0 });
    expect(stored).toMatchObject({ id_propietario: 'owner', hucha_id: 'trip', importe: 84.5, review_protected_fields: ['concepto', 'hucha_id', 'categoria'] });
    expect(result.hucha_changes.trip).toEqual({ nombre: 'Viaje', saldo_antes: 200, saldo_despues: 115.5 });
    expect(db.read('stats', 'owner').total_gastos).toBe(3084.5);
    expect(result.movement).not.toHaveProperty('id_propietario');
    expect(typeof result.movement.fecha_operacion).toBe('string');
  });

  it('sends an expense without wallet to its category wallet, then to the main one', async () => {
    db.put('review_configuration', 'owner', { revision: 1, category_huchas: { ocio: 'trip' } });
    expect((await expense({ categoria: 'ocio' })).movement.hucha_id).toBe('trip');
    expect((await expense({ categoria: 'alimentacion' })).movement.hucha_id).toBe('main');
    expect((await expense()).movement.hucha_id).toBe('main');
  });

  it('splits an income by wallet rules and restores everything when it is deleted', async () => {
    db.put('huchas', 'fixed', { ...db.read('huchas', 'fixed'), deuda_pendiente: 30, deuda_con: 'main' });
    const created = await service.create_movement('owner', { tipo: 'ingreso', concepto: 'Nómina', importe: 1000, fecha_operacion: '2026-10-01' });
    expect(balances()).toEqual({ main: 1880, trip: 250, fixed: 70 });
    expect(db.read('huchas', 'fixed').deuda_pendiente).toBe(0);
    expect(db.read('huchas', 'fixed')).not.toHaveProperty('deuda_con');
    expect(db.read('stats', 'owner').total_ingresos).toBe(6000);
    // The wallet rules change before the income is removed: the recorded split still undoes it exactly.
    db.put('huchas', 'fixed', { ...db.read('huchas', 'fixed'), valor_aportacion: 500 });
    await service.delete_movement('owner', { movement_id: created.movement.id });
    expect(balances()).toEqual({ main: 1000, trip: 200, fixed: 0 });
    expect(db.read('huchas', 'fixed')).toMatchObject({ deuda_pendiente: 30, deuda_con: 'main' });
    expect(db.read('stats', 'owner').total_ingresos).toBe(5000);
    expect(db.read('movimientos', created.movement.id)).toBeNull();
    expect(balances('other')).toEqual({ theirs: 500 });
  });

  it('applies a retried operation once', async () => {
    const first = await expense({ operation_id: 'retry-1' });
    const writes = db.committedWrites;
    expect(await expense({ operation_id: 'retry-1' })).toEqual(first);
    expect(db.committedWrites).toBe(writes);
    expect(balances().main).toBe(915.5);
    expect(Object.values(db.all('movimientos')).filter((m) => m.id_propietario === 'owner')).toHaveLength(1);
    await refused('operation_conflict', () => expense({ operation_id: 'retry-1', importe: 1 }));
    // Another user may reuse the same key without seeing this result.
    db.put('huchas', 'theirs', { ...db.read('huchas', 'theirs'), es_principal: true, activa: true });
    const other = await service.create_movement('other', { operation_id: 'retry-1', tipo: 'gasto', concepto: 'Otro', importe: 1, fecha_operacion: '2026-10-01' });
    expect(other.movement.id).not.toBe(first.movement.id);
  });

  it.each([
    ['invalid_category', { categoria: 'nomina' }], // income category on an expense
    ['invalid_hucha', { hucha_id: 'theirs' }], // someone else's wallet
    ['invalid_hucha', { hucha_id: 'missing' }],
    ['invalid_amount', { importe: 0 }],
    ['invalid_date', { fecha_operacion: 'mañana' }],
    ['invalid_name', { concepto: ' \u0000 ' }],
  ])('writes nothing for an invalid movement (%s)', async (code, args) => {
    await refused(code, () => expense(args));
  });

  it('never lets one user touch another user\'s data', async () => {
    await refused('not_found', () => service.get_movement('owner', { movement_id: 'theirs' }));
    await refused('not_found', () => service.delete_movement('owner', { movement_id: 'theirs' }));
    await refused('not_found', () => service.convert_movement('owner', { movement_id: 'theirs', target_hucha_id: 'main' }));
    await refused('not_found', () => service.restore_hucha('owner', { hucha_id: 'theirs' }));
    await refused('invalid_hucha', () => service.transfer_between_huchas('owner', { from_hucha_id: 'main', to_hucha_id: 'theirs', importe: 1 }));
    expect((await service.list_movements('owner')).items.every((m) => m.id !== 'theirs')).toBe(true);
    expect((await service.list_huchas('owner')).items.map((h) => h.id)).toEqual(['main', 'trip', 'fixed']);
  });

  it('records a cash withdrawal as an internal transfer removed as a whole', async () => {
    const result = await service.create_cash_withdrawal('owner', { hucha_origen_id: 'main', importe: 60, concepto: 'Cajero', fecha_operacion: '2026-10-02' });
    const [outLeg, inLeg] = result.movements;
    const cashId = inLeg.hucha_id;
    expect(db.read('huchas', cashId)).toMatchObject({ es_metalico: true, saldo_acumulado: 60 });
    expect(balances().main).toBe(940);
    expect(outLeg.transfer_id).toBe(inLeg.transfer_id);
    expect(db.read('stats', 'owner')).toEqual({ total_ingresos: 5000, total_gastos: 3000 });
    await refused('insufficient_balance', () => service.create_cash_withdrawal('owner', { hucha_origen_id: 'fixed', importe: 60, concepto: 'Cajero', fecha_operacion: '2026-10-02' }));
    const deleted = await service.delete_movement('owner', { movement_id: inLeg.id });
    expect(deleted.deleted).toHaveLength(2);
    expect(balances().main).toBe(1000);
    expect(db.read('huchas', cashId).saldo_acumulado).toBe(0);
    expect(db.read('movimientos', outLeg.id)).toBeNull();
  });

  it('uses the cash wallet for cash expenses', async () => {
    const movement = (await expense({ es_metalico: true, importe: 10 })).movement;
    expect(db.read('huchas', movement.hucha_id)).toMatchObject({ nombre: 'Efectivo', saldo_acumulado: -10 });
    expect((await expense({ es_metalico: true, importe: 5 })).movement.hucha_id).toBe(movement.hucha_id);
  });

  it('conserves money when converting back and forth', async () => {
    const movementId = (await expense({ hucha_id: 'trip', importe: 40, categoria: 'ocio' })).movement.id;
    await service.convert_movement('owner', { movement_id: movementId, distribution: [{ hucha_id: 'main', importe: 25 }, { hucha_id: 'fixed', importe: 15 }] });
    const stored = db.read('movimientos', movementId);
    expect(stored.tipo).toBe('ingreso');
    expect(stored).not.toHaveProperty('hucha_id');
    expect(stored).not.toHaveProperty('categoria');
    expect(balances()).toEqual({ main: 1025, trip: 200, fixed: 15 });
    expect(db.read('stats', 'owner')).toMatchObject({ total_ingresos: 5040, total_gastos: 3000 });
    await service.convert_movement('owner', { movement_id: movementId, target_hucha_id: 'trip' });
    expect(balances()).toEqual({ main: 1000, trip: 160, fixed: 0 });
    expect(db.read('movimientos', movementId).hucha_id).toBe('trip');
    expect(db.read('movimientos', movementId)).not.toHaveProperty('reparto_aplicado');
    await refused('invalid_distribution', () => service.convert_movement('owner', { movement_id: movementId, distribution: [{ hucha_id: 'main', importe: 1 }] }));
    const income = (await service.create_movement('owner', { tipo: 'ingreso', concepto: 'Venta', importe: 5, fecha_operacion: '2026-10-01' })).movement.id;
    await refused('missing_hucha', () => service.convert_movement('owner', { movement_id: income }));
  });

  it('returns an expense of an archived wallet to the default wallet', async () => {
    const movementId = (await expense({ hucha_id: 'trip', importe: 40 })).movement.id;
    db.put('huchas', 'trip', { ...db.read('huchas', 'trip'), activa: false, saldo_acumulado: 0 });
    await service.delete_movement('owner', { movement_id: movementId });
    expect(balances()).toEqual({ main: 1040, trip: 0, fixed: 0 });
  });

  it('links refunds, and deleting one side unlinks the other', async () => {
    const gasto = (await expense({ importe: 45 })).movement.id;
    const ingreso = (await service.create_movement('owner', { tipo: 'ingreso', concepto: 'Bizum cena', importe: 22.5, fecha_operacion: '2026-10-03', hucha_id: 'main' })).movement.id;
    await service.link_compensation('owner', { movement_id: gasto, allocations: [{ movement_id: ingreso, importe: 22.5 }] });
    expect(db.read('movimientos', gasto).importe_neto).toBe(22.5);
    expect(db.read('movimientos', ingreso).compensaciones_destinos).toEqual([{ gasto_id: gasto, importe: 22.5 }]);
    await refused('invalid_compensation', () => service.link_compensation('owner', { movement_id: gasto, allocations: [{ movement_id: ingreso, importe: 1 }] }));
    await refused('ineligible_movement', () => service.convert_movement('owner', { movement_id: gasto }));
    expect((await service.get_movement('owner', { movement_id: gasto })).related[0].id).toBe(ingreso);
    await service.delete_movement('owner', { movement_id: ingreso });
    expect(db.read('movimientos', gasto)).not.toHaveProperty('compensado_por_detalles');
    expect(db.read('movimientos', gasto)).not.toHaveProperty('importe_neto');
    await refused('not_linked', () => service.unlink_compensation('owner', { movement_id: gasto }));
  });
});

describe('wallets', () => {
  it('keeps roles unique and percentages within one hundred', async () => {
    const created = (await service.create_hucha('owner', { nombre: 'Ahorro', tipo_aportacion: 'resto', es_principal: true, objetivo: 5000, tope_objetivo: true })).hucha;
    expect(created).toMatchObject({ saldo_acumulado: 0, orden: 4, tope_objetivo: true });
    expect(db.read('huchas', 'main')).toMatchObject({ es_principal: false, tipo_aportacion: 'flat', valor_aportacion: 0 });
    expect(db.read('huchas', 'theirs').tipo_aportacion).toBe('resto');
    await refused('invalid_distribution', () => service.create_hucha('owner', { nombre: 'Demasiado', tipo_aportacion: 'porcentaje', valor_aportacion: 95 }));
    await refused('invalid_distribution', () => service.update_hucha('owner', { hucha_id: 'fixed', tipo_aportacion: 'porcentaje', valor_aportacion: 91 }));
    const updated = (await service.update_hucha('owner', { hucha_id: 'trip', objetivo: null, nombre: 'Japón' })).hucha;
    expect(updated).toMatchObject({ objetivo: null, tope_objetivo: false, valor_aportacion: 10, nombre: 'Japón' });
    await refused('invalid_edit', () => service.update_hucha('owner', { hucha_id: 'trip' }));
  });

  it('respects balance and capped goals when transferring', async () => {
    await service.transfer_between_huchas('owner', { from_hucha_id: 'main', to_hucha_id: 'fixed', importe: 100 });
    expect(balances()).toEqual({ main: 900, trip: 200, fixed: 100 });
    await refused('insufficient_balance', () => service.transfer_between_huchas('owner', { from_hucha_id: 'fixed', to_hucha_id: 'main', importe: 101 }));
    // Only 50 € fit in the capped trip wallet; the other 30 € go to the rest wallet instead of vanishing.
    const changes = (await service.transfer_between_huchas('owner', { from_hucha_id: 'fixed', to_hucha_id: 'trip', importe: 80 })).hucha_changes;
    expect(balances()).toEqual({ main: 930, trip: 250, fixed: 20 });
    expect(Object.keys(changes).sort()).toEqual(['fixed', 'main', 'trip']);
    await refused('no_capacity', () => service.transfer_between_huchas('owner', { from_hucha_id: 'main', to_hucha_id: 'trip', importe: 10 }));
  });

  it('moves the balance when archiving and refuses unsafe cases', async () => {
    await refused('invalid_distribution', () => service.archive_hucha('owner', { hucha_id: 'trip', distribution: [{ hucha_id: 'main', importe: 1 }] }));
    await refused('invalid_hucha', () => service.archive_hucha('owner', { hucha_id: 'trip', distribution: [{ hucha_id: 'theirs', importe: 200 }] }));
    await service.archive_hucha('owner', { hucha_id: 'trip' });
    expect(balances()).toEqual({ main: 1100, trip: 0, fixed: 100 });
    expect(db.read('huchas', 'trip').activa).toBe(false);
    expect((await service.list_huchas('owner')).items.map((h) => h.id)).toEqual(['main', 'fixed']);
    expect((await service.list_huchas('owner', { include_archived: true })).items).toHaveLength(3);
    await service.restore_hucha('owner', { hucha_id: 'trip' });
    expect(db.read('huchas', 'trip').activa).toBe(true);
    db.put('huchas', 'fixed', { ...db.read('huchas', 'fixed'), deuda_pendiente: 10, deuda_con: 'main' });
    await refused('unsupported_debt', () => service.archive_hucha('owner', { hucha_id: 'fixed' }));
    await refused('unsupported_debt', () => service.archive_hucha('owner', { hucha_id: 'main' }));
    db.put('huchas', 'solo', { id_propietario: 'solo', nombre: 'Única', saldo_acumulado: 0 });
    await refused('last_hucha', () => service.archive_hucha('solo', { hucha_id: 'solo' }));
  });

  it('lends between wallets and reverts the loan', async () => {
    await service.update_hucha('owner', { hucha_id: 'fixed', subsanar_hasta: 150, subsanar_con: 'trip' });
    const result = await service.cover_hucha_shortfall('owner', { hucha_id: 'fixed' });
    expect(result).toMatchObject({ amount: 150, lender_hucha_id: 'trip' });
    expect(balances()).toEqual({ main: 1000, trip: 50, fixed: 150 });
    expect(db.read('huchas', 'fixed')).toMatchObject({ deuda_pendiente: 150, deuda_con: 'trip' });
    const legs = Object.values(db.all('movimientos')).filter((m) => m.transfer_id);
    expect(legs).toHaveLength(2);
    expect(legs.every((m) => m.es_interno && m.fecha_operacion instanceof Date)).toBe(true);
    await refused('not_needed', () => service.cover_hucha_shortfall('owner', { hucha_id: 'fixed' }));
    await service.revert_hucha_debt('owner', { hucha_id: 'fixed' });
    expect(balances()).toEqual({ main: 1000, trip: 200, fixed: 0 });
    expect(db.read('huchas', 'fixed')).not.toHaveProperty('deuda_pendiente');
    expect(db.read('huchas', 'fixed')).not.toHaveProperty('deuda_con');
    await refused('not_needed', () => service.revert_hucha_debt('owner', { hucha_id: 'fixed' }));
  });
});

describe('subscriptions', () => {
  it('keeps the automatic wallet target in step', async () => {
    const netflix = await service.create_subscription('owner', { nombre: 'Netflix', importe: 17.99, dia_pago: 12, categoria: 'streaming' });
    const systemId = netflix.subscriptions_hucha.hucha_id;
    expect(db.read('huchas', systemId)).toMatchObject({ es_suscripciones: true, objetivo: 17.99, valor_aportacion: 17.99 });
    expect(netflix.subscription).toMatchObject({ hucha_id: systemId, frecuencia: 'mensual', fecha_inicio: '2026-10-10' });
    const spotify = await service.create_subscription('owner', { nombre: 'Spotify', importe: 14.99, mi_parte: 7.5, dia_pago: 20, hucha_id: 'main' });
    expect(spotify.subscriptions_hucha).toEqual({ hucha_id: systemId, monthly_target: 17.99 });
    await service.update_subscription('owner', { subscription_id: spotify.subscription.id, hucha_id: null });
    expect(db.read('huchas', systemId).objetivo).toBe(25.49);
    await service.update_subscription('owner', { subscription_id: netflix.subscription.id, activa: false });
    expect(db.read('huchas', systemId).objetivo).toBe(7.5);
    const listed = await service.list_subscriptions('owner');
    expect(listed.monthly_cost).toBe(7.5);
    expect(listed.items.map((s) => s.nombre).sort()).toEqual(['Netflix', 'Spotify']);
    expect(listed.items.find((s) => s.nombre === 'Spotify').next_charge).toBe('2026-10-20');
    const cancelled = (await service.cancel_subscription('owner', { subscription_id: spotify.subscription.id })).subscription;
    expect(cancelled).toMatchObject({ cancelando: true, cancel_at: '2026-10-20' });
    expect((await service.cancel_subscription('owner', { subscription_id: spotify.subscription.id, undo: true })).subscription.cancel_at).toBeNull();
    await service.delete_subscription('owner', { subscription_id: spotify.subscription.id });
    expect(db.read('huchas', systemId)).toMatchObject({ objetivo: null, valor_aportacion: 0 });
    await refused('managed_hucha', () => service.archive_hucha('owner', { hucha_id: systemId }));
    await refused('managed_hucha', () => service.update_hucha('owner', { hucha_id: systemId, valor_aportacion: 1 }));
  });

  it.each([
    ['invalid_subscription', { mi_parte: 20 }],
    ['invalid_hucha', { hucha_id: 'theirs' }],
    ['invalid_date', { fecha_inicio: '2026-02-30' }],
    ['invalid_amount', { importe: -3 }],
    ['invalid_subscription', { dia_pago: 0 }],
  ])('writes nothing for an invalid subscription (%s)', async (code, args) => {
    await refused(code, () => service.create_subscription('owner', { nombre: 'Gym', importe: 10, dia_pago: 2, ...args }));
  });
});

describe('pending emails and categories', () => {
  it('records an approved email once and hands it to review', async () => {
    db.put('correos_pendientes', 'gmail-1', { id_propietario: 'owner', email_id: 'gmail-1', cuerpo: 'Cargo de 24,99 EUR', procesado: false });
    db.put('correos_pendientes', 'gmail-x', { id_propietario: 'other', email_id: 'gmail-x', cuerpo: 'Ajeno', procesado: false });
    expect((await service.list_pending_emails('owner')).items.map((e) => e.id)).toEqual(['gmail-1']);
    const approve = () => service.approve_pending_email('owner', { email_id: 'gmail-1', tipo: 'gasto', concepto: 'Discord Nitro', importe: 24.99, fecha_operacion: '2026-05-22' });
    const movement = (await approve()).movement;
    expect(db.read('movimientos', movement.id).id_correo_origen).toBe('gmail-1');
    expect(balances().main).toBe(975.01);
    expect(db.read('review_handoffs', movement.id).email_id).toBe('gmail-1');
    expect(db.read('correos_pendientes', 'gmail-1')).toBeNull();
    expect(db.read('stats', 'owner').total_gastos).toBe(3024.99);
    await refused('not_found', approve);
    await refused('not_found', () => service.discard_pending_email('owner', { email_id: 'gmail-x' }));
    await service.discard_pending_email('other', { email_id: 'gmail-x' });
    expect(db.read('correos_pendientes', 'gmail-x')).toBeNull();
  });

  it('creates custom categories and assigns their wallets', async () => {
    const category = (await service.create_category('owner', { label: '  Mascotas ', tipo: 'gasto' })).category;
    expect(category.label).toBe('Mascotas');
    expect(db.read('categorias/owner/items', category.id).tipo).toBe('gasto');
    await refused('duplicate_category', () => service.create_category('owner', { label: 'mascotas', tipo: 'ambos' }));
    await refused('duplicate_category', () => service.create_category('owner', { label: 'Alimentación', tipo: 'gasto' }));
    expect(await service.set_category_hucha('owner', { category: category.id, hucha_id: 'trip' })).toEqual({ category_huchas: { [category.id]: 'trip' }, revision: 1 });
    expect((await expense({ categoria: category.id })).movement.hucha_id).toBe('trip');
    await refused('invalid_category', () => service.set_category_hucha('owner', { category: 'nomina', hucha_id: 'trip' }));
    await refused('not_found', () => service.set_category_hucha('owner', { category: 'ocio', hucha_id: 'theirs' }));
    expect(await service.set_category_hucha('owner', { category: category.id, hucha_id: null })).toEqual({ category_huchas: {}, revision: 2 });
    const listed = await service.list_categories('owner');
    expect(listed.categories).toContainEqual({ id: category.id, label: 'Mascotas', tipo: 'gasto' });
    expect(listed.category_huchas).toEqual({});
  });
});

describe('reads', () => {
  it('lists with filters and pages, and summarises', async () => {
    const day = (hours) => new Date(Date.UTC(2026, 9, 1, 12) + hours * 3_600_000).toISOString();
    await expense({ concepto: 'Súper Mercadona', importe: 50, categoria: 'alimentacion', fecha_operacion: day(1) });
    await expense({ concepto: 'Cine', importe: 20, categoria: 'ocio', hucha_id: 'trip', fecha_operacion: day(2) });
    await service.create_movement('owner', { tipo: 'ingreso', concepto: 'Nómina', importe: 1000, fecha_operacion: day(3), categoria: 'nomina' });
    await service.create_cash_withdrawal('owner', { hucha_origen_id: 'main', importe: 30, concepto: 'Cajero', fecha_operacion: day(4) });
    const first = await service.list_movements('owner', { limit: 2 });
    const second = await service.list_movements('owner', { limit: 2, cursor: first.next_cursor });
    const third = await service.list_movements('owner', { limit: 2, cursor: second.next_cursor });
    const seen = [first, second, third].flatMap((page) => page.items.map((m) => m.concepto));
    expect(seen).toHaveLength(5);
    expect(seen.slice(-3)).toEqual(['Nómina', 'Cine', 'Súper Mercadona']);
    expect(third.next_cursor).toBeNull();
    const concepts = async (filters) => (await service.list_movements('owner', filters)).items.map((m) => m.concepto);
    expect(await concepts({ text: 'super' })).toEqual(['Súper Mercadona']);
    expect(await concepts({ tipo: 'gasto', include_internal: false })).toEqual(['Cine', 'Súper Mercadona']);
    expect(await concepts({ hucha_id: 'trip' })).toEqual(['Cine']);
    expect(await concepts({ start_date: day(2), end_date: day(3) })).toEqual(['Cine']);
    const summary = await service.summarize_movements('owner', { start_date: day(0), end_date: day(10), group_by: 'category' });
    expect(Object.fromEntries(summary.groups.map((g) => [g.key, [g.ingresos, g.gastos]]))).toEqual({ nomina: [1000, 0], alimentacion: [0, 50], ocio: [0, 20] });
    expect(summary.totals).toEqual({ ingresos: 1000, gastos: 70 });
    expect(summary.truncated).toBe(false);
    const byWallet = await service.summarize_movements('owner', { start_date: day(0), end_date: day(10), group_by: 'hucha' });
    expect(byWallet.groups.map((g) => g.label).sort()).toEqual(['Cuenta', 'Reparto automático', 'Viaje']);
    const byMonth = await service.summarize_movements('owner', { start_date: day(0), end_date: day(10), group_by: 'month' });
    expect(byMonth.groups).toEqual([{ key: '2026-10', label: '2026-10', ingresos: 1000, gastos: 70, movements: 3 }]);
    const overview = await service.get_overview('owner');
    expect(overview.current_month).toEqual({ ingresos: 1000, gastos: 70, neto: 930 });
    expect(overview.previous_month).toEqual({ ingresos: 0, gastos: 0, neto: 0 });
    expect(overview.total_balance).toBe(Object.values(balances()).reduce((a, b) => a + b, 0));
    expect(overview.pending_emails).toBe(0);
    expect(overview.date).toBe('2026-10-10');
    expect(overview.huchas.slice(0, 3).map((h) => h.id)).toEqual(['main', 'trip', 'fixed']);
  });

  it('scopes email history to its owner and excerpts it', async () => {
    db.put('correos_historico', 'gmail-9', { id_propietario: 'owner', email_id: 'gmail-9', cuerpo: 'x'.repeat(900), movimientos_generados: ['m1'], created_at: NOW });
    db.put('correos_historico', 'gmail-z', { id_propietario: 'other', cuerpo: 'ajeno', created_at: NOW });
    const history = (await service.list_email_history('owner')).items;
    expect(history.map((e) => [e.id, e.excerpt.length, e.truncated])).toEqual([['gmail-9', 400, true]]);
    expect((await service.get_email('owner', { email_id: 'gmail-9' })).email.cuerpo).toHaveLength(900);
    await refused('not_found', () => service.get_email('owner', { email_id: 'gmail-z' }));
  });
});
