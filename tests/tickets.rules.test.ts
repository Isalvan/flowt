import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { rulesForTests } from './rulesSource';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Movement ticket rules', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
    env = await initializeTestEnvironment({ projectId: 'demo-flowt-tickets', firestore: { host, port: Number(port), rules: rulesForTests(['owner', 'other']) } });
  });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });
  const movement = { id_propietario: 'owner', tipo: 'gasto', concepto: 'Compra', importe: 20, fecha_operacion: new Date('2026-11-17') };
  const ticket = { comercio: 'Mercadona', lineas: [{ d: 'Leche', i: 20, p: [0, 1] }], personas: [{ nombre: 'Yo', importe: 10, yo: true }, { nombre: 'Ana', importe: 10 }] };

  it('allows creating a receipt and attaching only ticket to an existing bank movement', async () => {
    const db = env.authenticatedContext('owner').firestore();
    await assertSucceeds(setDoc(doc(db, 'movimientos', 'new'), { ...movement, ticket: { ...ticket, escaneado_at: serverTimestamp() } }));
    const ref = doc(db, 'movimientos', 'bank');
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'movimientos', 'bank'), { ...movement, field_provenance: { concepto: { source: 'automatic' } } }));
    await assertSucceeds(updateDoc(ref, { ticket }));
    await assertSucceeds(updateDoc(ref, { ticket: { comercio: 'Tienda', lineas: [] } }));
  });
  it.each([
    { ...ticket, lineas: Array.from({ length: 151 }, () => ({ d: 'Artículo', i: 1 })) },
    { ...ticket, personas: Array.from({ length: 13 }, () => ({ nombre: 'Persona', importe: 1 })) },
    { ...ticket, comercio: 'x'.repeat(121) },
    { ...ticket, lineas: {} },
    { ...ticket, personas: 'Ana' },
    { ...ticket, escaneado_at: 'ayer' },
    { ...ticket, image: 'never-store-images' },
    null,
    'ticket',
  ])('rejects invalid ticket on create and update: %j', async invalid => {
    const ref = doc(env.authenticatedContext('owner').firestore(), 'movimientos', 'g');
    await assertFails(setDoc(ref, { ...movement, ticket: invalid }));
    await assertSucceeds(setDoc(ref, movement));
    await assertFails(updateDoc(ref, { ticket: invalid }));
  });
  it('accepts the boundary sizes and rejects writes from another user', async () => {
    const ref = doc(env.authenticatedContext('owner').firestore(), 'movimientos', 'g');
    await assertSucceeds(setDoc(ref, { ...movement, ticket: { comercio: 'x'.repeat(120), lineas: Array.from({ length: 150 }, () => ({ d: 'Artículo', i: 1 })), personas: Array.from({ length: 12 }, () => ({ nombre: 'Persona', importe: 1 })) } }));
    await assertFails(updateDoc(doc(env.authenticatedContext('other').firestore(), 'movimientos', 'g'), { ticket }));
    await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), 'movimientos', 'g'), { ticket }));
  });
});
