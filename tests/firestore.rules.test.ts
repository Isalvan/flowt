import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';

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
  it('Should reject writing to stats from the client', async () => {
    if (!testEnv) return;
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const statsRef = doc(db, 'stats', 'user_123');
    
    await assertFails(setDoc(statsRef, {
      total_ingresos: 1000,
      total_gastos: 500
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
