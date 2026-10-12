import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, deleteDoc, updateDoc, writeBatch, serverTimestamp, getDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment | null = null;
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const describeRules = describe.skipIf(!emulatorAvailable);

beforeAll(async () => {
  if (!emulatorAvailable) return;
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-flowt-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host,
      port: Number(port),
    },
  });
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describeRules('Firestore Rules - Anclas de bancos', () => {
  it('allows owner creation and reads, and rejects foreign reads and writes', async () => {
    if (!testEnv) return;
    const db = testEnv.authenticatedContext('bank_owner').firestore();
    const ref = doc(db, 'bancos', 'bank_owner', 'items', 'bbva');
    const bank = { nombre: 'BBVA', created_at: serverTimestamp() };
    await assertSucceeds(setDoc(ref, bank));
    await assertSucceeds(getDoc(ref));
    await assertFails(setDoc(doc(db, 'bancos', 'bank_owner', 'items', 'invalid-date'), {
      ...bank, created_at: new Date(0),
    }));
    await assertFails(setDoc(doc(db, 'bancos', 'bank_owner', 'items', 'invalid-fields'), {
      ...bank, ancla_saldo: 100,
    }));
    for (const nombre of ['', 'x'.repeat(41), 42]) {
      await assertFails(setDoc(doc(db, 'bancos', 'bank_owner', 'items', 'invalid-name'), { ...bank, nombre }));
    }
    const otherDb = testEnv.authenticatedContext('other_owner').firestore();
    await assertFails(getDoc(doc(otherDb, 'bancos', 'bank_owner', 'items', 'bbva')));
    await assertFails(setDoc(doc(otherDb, 'bancos', 'bank_owner', 'items', 'foreign-create'), bank));
    await assertFails(deleteDoc(doc(otherDb, 'bancos', 'bank_owner', 'items', 'bbva')));
  });

  it('allows the owner to anchor and forbids foreign updates, invalid values and unrelated keys', async () => {
    if (!testEnv) return;
    const db = testEnv.authenticatedContext('bank_owner').firestore();
    const ref = doc(db, 'bancos', 'bank_owner', 'items', 'bbva');
    await assertSucceeds(setDoc(ref, { nombre: 'BBVA', created_at: serverTimestamp() }));
    const anchor = { ancla_saldo: 100, ancla_fecha: serverTimestamp(), ultimo_desfase: null, updated_at: serverTimestamp() };
    await assertSucceeds(updateDoc(ref, anchor));
    await assertSucceeds(updateDoc(ref, { ...anchor, ancla_saldo: -1000000, ultimo_desfase: -62.1 }));
    await assertSucceeds(updateDoc(ref, { ...anchor, ancla_saldo: 100000000 }));
    await assertFails(updateDoc(ref, { ...anchor, nombre: 'Otro banco' }));
    await assertFails(updateDoc(ref, { ...anchor, created_at: serverTimestamp() }));
    await assertFails(updateDoc(ref, { ...anchor, extra: true }));
    await assertFails(updateDoc(ref, { ...anchor, ancla_saldo: -1000001 }));
    await assertFails(updateDoc(ref, { ...anchor, ancla_saldo: 100000001 }));
    await assertFails(updateDoc(ref, { ...anchor, ancla_saldo: '100' }));
    await assertFails(updateDoc(ref, { ...anchor, ultimo_desfase: '0' }));
    await assertFails(updateDoc(ref, { ...anchor, ancla_fecha: new Date('2026-01-01') }));
    const otherDb = testEnv.authenticatedContext('other_owner').firestore();
    await assertFails(updateDoc(doc(otherDb, 'bancos', 'bank_owner', 'items', 'bbva'), anchor));
  });
});

describeRules('Firestore Rules - Settings', () => {
  const preferences = {
    horas_semanales: 40,
    umbral_compra_pequena: 20,
    inicio_periodo: 1,
    cifra_destacada: 'saldo',
  };

  it('allows owner creation and updates, including boundaries, payday and nullable preferences', async () => {
    if (!testEnv) return;
    const ref = doc(testEnv.authenticatedContext('user_123').firestore(), 'settings', 'user_123');
    await assertSucceeds(setDoc(ref, preferences));
    await assertSucceeds(getDoc(ref));
    for (const [index, values] of [
      { horas_semanales: 1, umbral_compra_pequena: 1, inicio_periodo: 1, cifra_destacada: 'x' },
      { horas_semanales: 80, umbral_compra_pequena: 100, inicio_periodo: 28, cifra_destacada: 'x'.repeat(128) },
      { horas_semanales: null, umbral_compra_pequena: 20, inicio_periodo: 'nomina', cifra_destacada: null },
    ].entries()) {
      const uid = `settings-${index}`;
      const variantRef = doc(testEnv.authenticatedContext(uid).firestore(), 'settings', uid);
      await assertSucceeds(setDoc(variantRef, values));
      await assertSucceeds(updateDoc(variantRef, { ...preferences, updated_at: serverTimestamp() }));
      await assertSucceeds(updateDoc(variantRef, values));
    }
  });

  it.each([
    ['horas_semanales', 0], ['horas_semanales', 81], ['horas_semanales', '40'],
    ['umbral_compra_pequena', 0], ['umbral_compra_pequena', 101], ['umbral_compra_pequena', null], ['umbral_compra_pequena', '20'],
    ['inicio_periodo', 0], ['inicio_periodo', 29], ['inicio_periodo', 1.5], ['inicio_periodo', '1'], ['inicio_periodo', null],
    ['cifra_destacada', ''], ['cifra_destacada', 'x'.repeat(129)], ['cifra_destacada', 42],
  ])('rejects invalid %s = %s on creation and update', async (field, value) => {
    if (!testEnv) return;
    const ref = doc(testEnv.authenticatedContext('user_123').firestore(), 'settings', 'user_123');
    await assertFails(setDoc(ref, { ...preferences, [field]: value }));
    await assertSucceeds(setDoc(ref, preferences));
    await assertFails(updateDoc(ref, { [field]: value }));
  });

  it('rejects another user reading, creating or updating settings', async () => {
    if (!testEnv) return;
    const otherDb = testEnv.authenticatedContext('other_user').firestore();
    const foreignRef = doc(otherDb, 'settings', 'user_123');
    await assertFails(setDoc(foreignRef, preferences));
    await assertSucceeds(setDoc(doc(testEnv.authenticatedContext('user_123').firestore(), 'settings', 'user_123'), preferences));
    await assertFails(getDoc(foreignRef));
    await assertFails(updateDoc(foreignRef, { inicio_periodo: 'nomina' }));
  });
});

describeRules('Firestore Rules - Movimientos', () => {
  it('allows updating only banco and updated_at on an existing movement', async () => {
    if (!testEnv) return;
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'movimientos', 'bank-change'), {
        id_propietario: 'user_123', tipo: 'gasto', concepto: 'Compra', importe: 20,
        fecha_operacion: new Date(), banco: 'BBVA', created_at: new Date(0),
        review_version: 1, field_provenance: { concepto: { source: 'automatic' } },
      });
    });
    const changes = { banco: 'ING', updated_at: serverTimestamp() };
    const ref = doc(testEnv.authenticatedContext('user_123').firestore(), 'movimientos', 'bank-change');
    await assertSucceeds(updateDoc(ref, changes));
    await assertFails(updateDoc(ref, { ...changes, created_at: serverTimestamp() }));
    await assertFails(updateDoc(doc(testEnv.authenticatedContext('other_user').firestore(), 'movimientos', 'bank-change'), changes));
  });

  it('allows creating a movement with reparto_aplicado and saving duplicados_descartados', async () => {
    if (!testEnv) return;
    const db = testEnv.authenticatedContext('user_123').firestore();
    const ref = doc(db, 'movimientos', 'distribution');
    await assertSucceeds(setDoc(ref, {
      id_propietario: 'user_123', tipo: 'ingreso', concepto: 'Nomina', importe: 1000,
      fecha_operacion: new Date(), reparto_aplicado: { saldos: { wallet: 1000 }, deudas: {} },
      duplicados_descartados: ['duplicate-1'],
    }));
    await assertSucceeds(updateDoc(ref, { duplicados_descartados: ['duplicate-1', 'duplicate-2'] }));
    await assertFails(updateDoc(doc(testEnv.authenticatedContext('other_user').firestore(), 'movimientos', 'distribution'), {
      duplicados_descartados: ['duplicate-3'],
    }));
  });

  it('permite categorías propias del usuario y rechaza categorías ajenas o de otro tipo', async () => {
    if (!testEnv) return;
    const db = testEnv.authenticatedContext('user_123').firestore();
    const otherDb = testEnv.authenticatedContext('other_user').firestore();
    const id = 'custom_' + 'a'.repeat(64);
    const incomeId = 'custom_' + 'b'.repeat(64);
    const categoryRef = doc(db, 'categorias', 'user_123', 'items', id);
    await assertSucceeds(setDoc(categoryRef, { label: 'Regalos', tipo: 'gasto', created_at: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, 'categorias', 'user_123', 'items', incomeId), { label: 'Otros regalos', tipo: 'ingreso', created_at: serverTimestamp() }));
    await assertFails(getDoc(doc(otherDb, 'categorias', 'user_123', 'items', id)));
    await assertFails(setDoc(doc(otherDb, 'categorias', 'user_123', 'items', 'custom_' + 'c'.repeat(64)), { label: 'Ajena', tipo: 'gasto', created_at: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'categorias', 'user_123', 'items', 'custom_' + 'd'.repeat(64)), { label: '', tipo: 'gasto', created_at: serverTimestamp() }));
    const movementRef = doc(db, 'movimientos', 'custom-category');
    await assertSucceeds(setDoc(movementRef, { id_propietario: 'user_123', tipo: 'gasto', concepto: 'Regalo', importe: 20, fecha_operacion: new Date(), categoria: id }));
    await assertSucceeds(updateDoc(movementRef, { categoria: id, updated_at: serverTimestamp() }));
    await assertFails(updateDoc(movementRef, { categoria: incomeId }));
    await assertFails(updateDoc(movementRef, { categoria: 'custom_' + 'e'.repeat(64) }));
    await assertFails(updateDoc(doc(otherDb, 'movimientos', 'custom-category'), { categoria: id }));
  });
  it('permite revisar categorías y rechazar parejas solo al propietario', async () => {
    if (!testEnv) return;
    const db = testEnv.authenticatedContext('user_123').firestore();
    const ref = doc(db, 'movimientos', 'category-review');
    await assertSucceeds(setDoc(ref, { id_propietario: 'user_123', tipo: 'gasto', concepto: 'Comercio de ejemplo', importe: 40, fecha_operacion: new Date(), categoria_sugerida: 'compras', categoria_confianza: 'baja' }));
    await assertSucceeds(updateDoc(ref, { categoria: 'tecnologia', compensaciones_descartadas: ['example-income'] }));
    await assertFails(updateDoc(ref, { categoria: 'nomina' }));
    await assertFails(updateDoc(ref, { categoria_sugerida: 'inventada' }));
    await assertFails(updateDoc(ref, { categoria_confianza: 'segurisimo' }));
    await assertFails(updateDoc(ref, { compensaciones_descartadas: 'wrong-type' }));
    await assertFails(updateDoc(ref, { compensaciones_descartadas: Array.from({ length: 201 }, (_, i) => String(i)) }));
    const otherDb = testEnv.authenticatedContext('other_user').firestore();
    await assertFails(updateDoc(doc(otherDb, 'movimientos', 'category-review'), { categoria: 'compras' }));
  });
  it('Should allow authenticated user to create a valid movement', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    await assertSucceeds(setDoc(movRef, {
      id_propietario: 'user_123',
      tipo: 'gasto',
      concepto: 'Mercadona',
      importe: 45.50,
      fecha_operacion: new Date()
    }));
  });

  it('Should reject movement with missing fields', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    await assertFails(setDoc(movRef, {
      id_propietario: 'user_123',
      tipo: 'gasto',
      importe: 45.50
    }));
  });

  it('Should reject movement with unknown fields', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    await assertFails(setDoc(movRef, {
      id_propietario: 'user_123',
      tipo: 'gasto',
      concepto: 'Mercadona',
      importe: 45.50,
      fecha_operacion: new Date(),
      hack_field: 'malicious'
    }));
  });

  it('Should reject negative importe', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    await assertFails(setDoc(movRef, {
      id_propietario: 'user_123',
      tipo: 'gasto',
      concepto: 'Mercadona',
      importe: -45.50,
      fecha_operacion: new Date()
    }));
  });
});

describeRules('Firestore Rules - Stats', () => {
  it('Should allow an owner to write their stats', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const statsRef = doc(db, 'stats', 'user_123');
    
    await assertSucceeds(setDoc(statsRef, {
      total_ingresos: 1000,
      total_gastos: 500,
      updated_at: new Date(),
    }));
  });

  it('Should reject writing another user stats', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();

    await assertFails(setDoc(doc(db, 'stats', 'other_user'), {
      total_ingresos: 1000,
      total_gastos: 500,
    }));
  });
});

describeRules('Firestore Rules - Correos Historico', () => {
  it('Should reject writing to correos_historico from the client', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const histRef = doc(db, 'correos_historico', 'email_123');
    
    await assertFails(setDoc(histRef, {
      cuerpo: 'fake email'
    }));
  });
});

describeRules('Firestore Rules - Huchas Protegidas', () => {
  const wallet = {
    id_propietario: 'user_123', nombre: 'Extras', tipo_aportacion: 'flat',
    saldo_acumulado: 0, es_principal: false, activa: true,
  };

  it('allows valid extra fields on creation and update, including boundaries and null', async () => {
    if (!testEnv) return;
    const ref = doc(testEnv.authenticatedContext('user_123').firestore(), 'huchas', 'extras');
    for (const [index, extras] of [
      { extra_importe: 50, extra_meses: [6, 12], extra_ultimo: '2026-10' },
      { extra_importe: 0, extra_meses: [], extra_ultimo: '2026-01' },
      { extra_importe: 100000, extra_meses: Array.from({ length: 12 }, (_, i) => i + 1), extra_ultimo: '2026-12' },
      { extra_importe: null, extra_meses: null, extra_ultimo: null },
    ].entries()) {
      const variantRef = doc(ref.parent, `extras-${index}`);
      await assertSucceeds(setDoc(variantRef, { ...wallet, ...extras }));
      await assertSucceeds(updateDoc(variantRef, { extra_importe: 25, extra_meses: [1], extra_ultimo: '2026-02' }));
      await assertSucceeds(updateDoc(variantRef, extras));
    }
  });

  it.each([
    ['extra_importe', -1], ['extra_importe', 100001], ['extra_importe', '50'],
    ['extra_meses', Array.from({ length: 13 }, (_, i) => i + 1)], ['extra_meses', '6,12'],
    ['extra_ultimo', '2026-1'], ['extra_ultimo', '2026-100'], ['extra_ultimo', 202610],
  ])('rejects invalid %s = %s on creation and update', async (field, value) => {
    if (!testEnv) return;
    const ref = doc(testEnv.authenticatedContext('user_123').firestore(), 'huchas', 'extras');
    await assertFails(setDoc(ref, { ...wallet, [field]: value }));
    await assertSucceeds(setDoc(ref, wallet));
    await assertFails(updateDoc(ref, { [field]: value }));
  });

  it('Should reject deleting a subscription wallet', async () => {
    if (!testEnv) return;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'huchas', 'sys_wallet'), {
        id_propietario: 'user_123',
        nombre: 'Suscripciones',
        es_suscripciones: true
      });
    });

    const userContext = testEnv.authenticatedContext('user_123');
    const db = userContext.firestore();
    await assertFails(deleteDoc(doc(db, 'huchas', 'sys_wallet')));
  });

  it('Should allow wallet fields used by transfers and debt settlement', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();

    await assertSucceeds(setDoc(doc(db, 'huchas', 'wallet1'), {
      id_propietario: 'user_123',
      nombre: 'Efectivo',
      tipo_aportacion: 'flat',
      valor_aportacion: 0,
      saldo_acumulado: -10,
      objetivo: 200,
      orden: 2,
      es_principal: false,
      es_metalico: true,
      activa: true,
      tope_objetivo: true,
      subsanar_con: 'wallet2',
      subsanar_hasta: 0,
      deuda_pendiente: 10,
      deuda_con: 'wallet2',
    }));
  });

  it('Should allow updating an old wallet without changing its legacy field', async () => {
    if (!testEnv) return;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'huchas', 'legacy_wallet'), {
        id_propietario: 'user_123',
        nombre: 'Antigua',
        tipo_aportacion: 'flat',
        saldo_acumulado: 20,
        es_principal: false,
        activa: true,
        legacy_field: 'preserved',
      });
    });

    const context = testEnv.authenticatedContext('user_123');
    await assertSucceeds(updateDoc(doc(context.firestore(), 'huchas', 'legacy_wallet'), {
      nombre: 'Actualizada',
    }));
    await assertFails(updateDoc(doc(context.firestore(), 'huchas', 'legacy_wallet'), {
      legacy_field: 'changed',
    }));
  });

  it('Should reject transferring ownership', async () => {
    if (!testEnv) return;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'movimientos', 'mov1'), {
        id_propietario: 'user_123',
        tipo: 'gasto',
        concepto: 'Mercadona',
        importe: 45.50,
        fecha_operacion: new Date()
      });
    });

    const userContext = testEnv.authenticatedContext('user_123');
    const db = userContext.firestore();
    await assertFails(updateDoc(doc(db, 'movimientos', 'mov1'), {
      id_propietario: 'hacker_999'
    }));
  });

  it('Should allow reassigning a movement hucha_id and updating hucha balances in a transaction/batch', async () => {
    if (!testEnv) return;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'huchas', 'test-principal-pocket'), {
        id_propietario: 'user_123',
        nombre: 'Hucha A',
        tipo_aportacion: 'flat',
        saldo_acumulado: 100,
        es_principal: false,
        activa: true,
      });
      await setDoc(doc(db, 'huchas', 'L7nVAw8fP9NPdWtKSn5U'), {
        id_propietario: 'user_123',
        nombre: 'Hucha B',
        tipo_aportacion: 'flat',
        saldo_acumulado: 500,
        es_principal: false,
        activa: true,
      });
      await setDoc(doc(db, 'movimientos', 'e553ae9cdef9e8dc4295bf2900d36d24a775e1f2b54848bad22c673d6d75433a'), {
        id_propietario: 'user_123',
        tipo: 'gasto',
        concepto: 'Supermercado',
        importe: 50,
        fecha_operacion: new Date(),
        hucha_id: 'test-principal-pocket',
      });
    });

    const userContext = testEnv.authenticatedContext('user_123');
    const db = userContext.firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, 'huchas', 'test-principal-pocket'), { saldo_acumulado: 150 });
    batch.update(doc(db, 'huchas', 'L7nVAw8fP9NPdWtKSn5U'), { saldo_acumulado: 450 });
    batch.update(doc(db, 'movimientos', 'e553ae9cdef9e8dc4295bf2900d36d24a775e1f2b54848bad22c673d6d75433a'), { hucha_id: 'L7nVAw8fP9NPdWtKSn5U' });

    await assertSucceeds(batch.commit());
  });

  it('Should allow reassigning a movement when a hucha has no tipo_aportacion or optional fields', async () => {
    if (!testEnv) return;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'huchas', 'hucha_no_tipo'), {
        id_propietario: 'user_123',
        nombre: 'Legacy/System Hucha',
        saldo_acumulado: 100,
        es_principal: false,
        activa: true,
      });
      await setDoc(doc(db, 'huchas', 'hucha_normal'), {
        id_propietario: 'user_123',
        nombre: 'Normal Hucha',
        tipo_aportacion: 'flat',
        saldo_acumulado: 500,
        es_principal: false,
        activa: true,
      });
      await setDoc(doc(db, 'movimientos', 'mov_test'), {
        id_propietario: 'user_123',
        tipo: 'gasto',
        concepto: 'Gasto Test',
        importe: 50,
        fecha_operacion: new Date(),
        hucha_id: 'hucha_no_tipo',
      });
    });

    const userContext = testEnv.authenticatedContext('user_123');
    const db = userContext.firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, 'huchas', 'hucha_no_tipo'), { saldo_acumulado: 150 });
    batch.update(doc(db, 'huchas', 'hucha_normal'), { saldo_acumulado: 450 });
    batch.update(doc(db, 'movimientos', 'mov_test'), { hucha_id: 'hucha_normal' });

    await assertSucceeds(batch.commit());
  });

  it('Should allow updating hucha_id on a movement that has long or sanitized concept or missing concept', async () => {
    if (!testEnv) return;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'movimientos', 'mov_long_concepto'), {
        id_propietario: 'user_123',
        tipo: 'gasto',
        concepto: 'a'.repeat(250), // long concept imported from email
        importe: 50,
        fecha_operacion: new Date(),
        hucha_id: 'test-principal-pocket',
      });
    });

    const userContext = testEnv.authenticatedContext('user_123');
    const db = userContext.firestore();
    await assertSucceeds(updateDoc(doc(db, 'movimientos', 'mov_long_concepto'), { hucha_id: 'L7nVAw8fP9NPdWtKSn5U' }));
  });
});

describeRules('Firestore Rules - Frontend fields', () => {
  it('Should allow the automatic subscriptions wallet creation', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');

    await assertSucceeds(setDoc(doc(context.firestore(), 'huchas', 'subscriptions_wallet'), {
      id_propietario: 'user_123',
      nombre: 'Suscripciones',
      tipo_aportacion: 'flat',
      valor_aportacion: 15,
      objetivo: 15,
      saldo_acumulado: 0,
      orden: 1,
      es_principal: false,
      es_suscripciones: true,
      activa: true,
      tope_objetivo: false,
    }));
  });

  it('Should allow the automatic cash wallet creation', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');

    await assertSucceeds(setDoc(doc(context.firestore(), 'huchas', 'cash_wallet'), {
      id_propietario: 'user_123',
      nombre: 'Efectivo',
      tipo_aportacion: 'flat',
      valor_aportacion: 0,
      objetivo: null,
      saldo_acumulado: 0,
      orden: 2,
      es_metalico: true,
      es_principal: false,
      activa: true,
    }));
  });

  it('Should allow internal cash movements', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');

    await assertSucceeds(setDoc(doc(context.firestore(), 'movimientos', 'cash1'), {
      id_propietario: 'user_123',
      tipo: 'gasto',
      concepto: 'Retirada de efectivo',
      importe: 50,
      fecha_operacion: new Date(),
      es_metalico: true,
      es_interno: true,
      transfer_id: 'transfer-1',
    }));
  });

  it('Should allow subscription fields written by the frontend', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');

    await assertSucceeds(setDoc(doc(context.firestore(), 'suscripciones', 'sub1'), {
      id_propietario: 'user_123',
      nombre: 'Netflix',
      importe: 15,
      frecuencia: 'mensual',
      fecha_inicio: '2026-07-30',
      dia_pago: 30,
      categoria: 'Entretenimiento',
      color: '#ff0000',
      activa: true,
      mi_parte: 7.5,
    }));
  });
});
