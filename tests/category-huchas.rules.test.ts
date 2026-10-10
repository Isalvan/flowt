import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Category hucha configuration rules', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
    env = await initializeTestEnvironment({ projectId: 'demo-flowt-category-map', firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') } });
  });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'huchas', 'own'), { id_propietario: 'owner', activa: true });
      await setDoc(doc(db, 'huchas', 'inactive'), { id_propietario: 'owner', activa: false });
      await setDoc(doc(db, 'huchas', 'foreign'), { id_propietario: 'other', activa: true });
      await setDoc(doc(db, 'huchas', 'cash'), { id_propietario: 'owner', activa: true, es_metalico: true });
      await setDoc(doc(db, 'huchas', 'internal'), { id_propietario: 'owner', activa: true, es_interno: true });
      await setDoc(doc(db, 'categorias', 'owner', 'items', 'custom_' + 'a'.repeat(64)), { label: 'Mascotas', tipo: 'ambos' });
      await setDoc(doc(db, 'categorias', 'owner', 'items', 'custom_' + 'b'.repeat(64)), { label: 'Ingresos', tipo: 'ingreso' });
    });
  });
  const config = (map: Record<string, unknown>, revision: number, category: string) => ({ category_huchas: map, revision, last_changed_category: category, updated_at: serverTimestamp() });

  it('allows owner assignment, custom expense categories, reassignment and removal with successive revisions', async () => {
    const db = env.authenticatedContext('owner').firestore();
    const ref = doc(db, 'review_configuration', 'owner');
    const custom = 'custom_' + 'a'.repeat(64);
    await assertSucceeds(setDoc(ref, config({ alimentacion: 'own' }, 1, 'alimentacion')));
    await assertSucceeds(setDoc(ref, config({ alimentacion: 'own', [custom]: 'own' }, 2, custom)));
    await assertSucceeds(setDoc(ref, config({ [custom]: 'own' }, 3, 'alimentacion')));
    await assertSucceeds(getDoc(ref));
    await assertFails(getDoc(doc(env.authenticatedContext('other').firestore(), 'review_configuration', 'owner')));
  });

  it('rejects foreign/inactive/missing targets, income/unknown categories, null values and unauthenticated writes', async () => {
    const db = env.authenticatedContext('owner').firestore();
    const ref = doc(db, 'review_configuration', 'owner');
    for (const target of ['foreign', 'inactive', 'missing', 'cash', 'internal', null]) {
      await assertFails(setDoc(ref, config({ alimentacion: target }, 1, 'alimentacion')));
    }
    for (const category of ['nomina', 'unknown', 'custom_' + 'b'.repeat(64), 'custom_' + 'c'.repeat(64)]) {
      await assertFails(setDoc(ref, config({ [category]: 'own' }, 1, category)));
    }
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'review_configuration', 'owner'), config({ alimentacion: 'own' }, 1, 'alimentacion')));
    await assertFails(setDoc(doc(env.authenticatedContext('other').firestore(), 'review_configuration', 'owner'), config({ alimentacion: 'own' }, 1, 'alimentacion')));
  });

  it('rejects multiple key changes, stale revisions, forged dates and extra fields', async () => {
    const ref = doc(env.authenticatedContext('owner').firestore(), 'review_configuration', 'owner');
    await assertFails(setDoc(ref, config({ alimentacion: 'own', ocio: 'own' }, 1, 'alimentacion')));
    await assertSucceeds(setDoc(ref, config({ alimentacion: 'own' }, 1, 'alimentacion')));
    await assertFails(setDoc(ref, config({ alimentacion: 'own', ocio: 'own' }, 1, 'ocio')));
    await assertFails(setDoc(ref, { ...config({}, 2, 'alimentacion'), updated_at: new Date(0) }));
    await assertFails(setDoc(ref, { ...config({}, 2, 'alimentacion'), arbitrary: true }));
  });

  it('allows clearing an assignment after its target is archived without dropping other assignments', async () => {
    const ref = doc(env.authenticatedContext('owner').firestore(), 'review_configuration', 'owner');
    await assertSucceeds(setDoc(ref, config({ alimentacion: 'own' }, 1, 'alimentacion')));
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'huchas', 'own'), { id_propietario: 'owner', activa: false }));
    await assertSucceeds(setDoc(ref, config({}, 2, 'alimentacion')));
  });
});
