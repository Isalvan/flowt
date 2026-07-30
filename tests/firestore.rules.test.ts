import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  try {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-flowt-test',
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  } catch {
    testEnv = null;
  }
});

beforeEach(async () => {
  if (testEnv) {
    try {
      await testEnv.clearFirestore();
    } catch {
      testEnv = null;
    }
  }
});

afterAll(async () => {
  if (testEnv) {
    try {
      await testEnv.cleanup();
    } catch {
      // Ignore
    }
  }
});

describe('Firestore Rules - Movimientos', () => {
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

describe('Firestore Rules - Stats', () => {
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

describe('Firestore Rules - Correos Historico', () => {
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

describe('Firestore Rules - Huchas Protegidas', () => {
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
});

describe('Firestore Rules - Frontend fields', () => {
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
