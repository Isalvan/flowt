import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { rulesForTests } from './rulesSource';
import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let environment: RulesTestEnvironment;
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

beforeAll(async () => {
  if (!emulatorAvailable) return;
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  environment = await initializeTestEnvironment({
    projectId: 'demo-flowt-review-security',
    firestore: { host, port: Number(port), rules: rulesForTests(['owner', 'other']) },
  });
});

beforeEach(async () => {
  if (environment) await environment.clearFirestore();
});

afterAll(async () => {
  if (environment) await environment.cleanup();
});

const movement = () => ({
  id_propietario: 'owner', tipo: 'gasto', concepto: 'Servicio revisado', importe: 20,
  fecha_operacion: new Date('2026-10-04'), categoria: 'tecnologia', hucha_id: 'wallet',
  suscripcion_id: 'subscription', review_version: 2,
  field_provenance: {
    concepto: { source: 'automatic', review_id: 'review' },
    categoria: { source: 'automatic', review_id: 'review' },
    hucha_id: { source: 'automatic', review_id: 'review' },
    suscripcion_id: { source: 'automatic', review_id: 'review' },
  },
  review_protected_fields: ['categoria'],
});

async function seedReviewed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'movimientos', 'reviewed'), movement());
  });
}

describe.skipIf(!emulatorAvailable)('Automatic review security rules (real emulator)', () => {
  it.each([
    ['concepto', 'Mi descripción'], ['categoria', 'compras'], ['hucha_id', 'other-wallet'], ['suscripcion_id', 'other-subscription'],
  ])('requires field protection when manually changing reviewed %s', async (field, value) => {
    await seedReviewed();
    const reference = doc(environment.authenticatedContext('owner').firestore(), 'movimientos', 'reviewed');
    if (field !== 'categoria') await assertFails(updateDoc(reference, { [field]: value }));
    await assertSucceeds(updateDoc(reference, {
      [field]: value, review_protected_fields: [...new Set(['categoria', field])], updated_at: serverTimestamp(),
    }));
    expect((await getDoc(reference)).data()?.review_protected_fields).toContain(field);
  });

  it('cannot remove existing protected fields or remove immutable review metadata', async () => {
    await seedReviewed();
    const reference = doc(environment.authenticatedContext('owner').firestore(), 'movimientos', 'reviewed');
    await assertFails(updateDoc(reference, { review_protected_fields: [] }));
    await assertFails(updateDoc(reference, { review_protected_fields: deleteField() }));
    await assertFails(updateDoc(reference, { field_provenance: deleteField() }));
    await assertFails(updateDoc(reference, { review_version: 3 }));
    await assertFails(updateDoc(reference, { field_provenance: { concepto: { source: 'automatic', review_id: 'forged' } } }));
  });

  it('cannot forge automatic provenance or versions on new movements', async () => {
    const db = environment.authenticatedContext('owner').firestore();
    const base = { id_propietario: 'owner', tipo: 'gasto', concepto: 'Manual', importe: 5, fecha_operacion: new Date() };
    await assertFails(setDoc(doc(db, 'movimientos', 'forged-version'), { ...base, review_version: 4 }));
    await assertFails(setDoc(doc(db, 'movimientos', 'forged-provenance'), { ...base, field_provenance: { concepto: { source: 'automatic' } } }));
    await assertSucceeds(setDoc(doc(db, 'movimientos', 'manual'), { ...base, review_protected_fields: ['concepto'] }));
  });

  it.each(['review_history', 'review_jobs', 'email_processing', 'review_questions'])('isolates owner reads and prevents client writes to %s', async (collection) => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), collection, 'owned'), { id_propietario: 'owner', state: 'pending' });
    });
    const ownerDb = environment.authenticatedContext('owner').firestore();
    const otherDb = environment.authenticatedContext('other').firestore();
    const anonymousDb = environment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(ownerDb, collection, 'owned')));
    await assertFails(getDoc(doc(otherDb, collection, 'owned')));
    await assertFails(getDoc(doc(anonymousDb, collection, 'owned')));
    await assertFails(setDoc(doc(ownerDb, collection, 'forged'), { id_propietario: 'owner', state: 'reviewed' }));
    await assertFails(updateDoc(doc(ownerDb, collection, 'owned'), { state: 'reviewed' }));
  });

  it('validates an approved handoff against the movement created in the same batch using getAfter', async () => {
    const db = environment.authenticatedContext('owner').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'movimientos', 'approved'), {
      id_propietario: 'owner', tipo: 'gasto', concepto: 'Aprobado', importe: 12,
      fecha_operacion: new Date(), id_correo_origen: 'real-email',
    });
    batch.set(doc(db, 'review_handoffs', 'approved'), {
      id_propietario: 'owner', movement_id: 'approved', email_id: 'real-email', created_at: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(db, 'review_handoffs', 'approved')));
    await assertFails(getDoc(doc(environment.authenticatedContext('other').firestore(), 'review_handoffs', 'approved')));
    await assertFails(updateDoc(doc(db, 'review_handoffs', 'approved'), { email_id: 'changed' }));
  });

  it('rejects forged handoff email and leaves the whole batch uncommitted', async () => {
    const db = environment.authenticatedContext('owner').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'movimientos', 'forged'), {
      id_propietario: 'owner', tipo: 'gasto', concepto: 'Aprobado', importe: 12,
      fecha_operacion: new Date(), id_correo_origen: 'real-email',
    });
    batch.set(doc(db, 'review_handoffs', 'forged'), {
      id_propietario: 'owner', movement_id: 'forged', email_id: 'fake-email', created_at: serverTimestamp(),
    });
    await assertFails(batch.commit());
    await environment.withSecurityRulesDisabled(async (context) => {
      expect((await getDoc(doc(context.firestore(), 'movimientos', 'forged'))).exists()).toBe(false);
    });
  });

  it('rejects handoff for another owner movement or a nonexistent movement', async () => {
    await seedReviewed();
    const otherDb = environment.authenticatedContext('other').firestore();
    await assertFails(setDoc(doc(otherDb, 'review_handoffs', 'reviewed'), {
      id_propietario: 'other', movement_id: 'reviewed', email_id: 'email', created_at: serverTimestamp(),
    }));
    const db = environment.authenticatedContext('owner').firestore();
    await assertFails(setDoc(doc(db, 'review_handoffs', 'missing'), {
      id_propietario: 'owner', movement_id: 'missing', email_id: 'email', created_at: serverTimestamp(),
    }));
  });
});
