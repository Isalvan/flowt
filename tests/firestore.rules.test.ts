import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-flowt-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore Rules - Movimientos', () => {
  it('Should allow authenticated user to create a valid movement', async () => {
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    await assertSucceeds(setDoc(movRef, {
      id_propietario: 'user_123',
      tipo: 'gasto',
      concepto: 'Supermercado',
      importe: 50.5,
      fecha_operacion: new Date(),
      created_at: new Date()
    }));
  });

  it('Should reject movement with missing fields', async () => {
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    await assertFails(setDoc(movRef, {
      id_propietario: 'user_123',
      tipo: 'gasto',
      importe: 50.5
      // Missing concepto, fecha_operacion, created_at
    }));
  });

  it('Should reject movement with unknown fields', async () => {
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    await assertFails(setDoc(movRef, {
      id_propietario: 'user_123',
      tipo: 'gasto',
      concepto: 'Supermercado',
      importe: 50.5,
      fecha_operacion: new Date(),
      created_at: new Date(),
      unknown_field: 'malicious payload' // Not in hasAll
    }));
  });

  it('Should reject negative importe', async () => {
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    await assertFails(setDoc(movRef, {
      id_propietario: 'user_123',
      tipo: 'gasto',
      concepto: 'Supermercado',
      importe: -10, // Invalid
      fecha_operacion: new Date(),
      created_at: new Date()
    }));
  });
});

describe('Firestore Rules - Stats', () => {
  it('Should reject writing to stats from the client', async () => {
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const statsRef = doc(db, 'stats', 'user_123');
    
    await assertFails(setDoc(statsRef, {
      total_ingresos: 1000,
      total_gastos: 500,
      updated_at: new Date()
    }));
  });
});

describe('Firestore Rules - Correos Historico', () => {
  it('Should reject writing to correos_historico from the client', async () => {
    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const histRef = doc(db, 'correos_historico', 'email_123');
    
    await assertFails(setDoc(histRef, {
      id_propietario: 'user_123',
      cuerpo: '<script>alert("xss")</script>'
    }));
  });
});

describe('Firestore Rules - Huchas Protegidas', () => {
  it('Should reject deleting a subscription wallet', async () => {
    // Setup with admin context
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'huchas', 'sys_wallet'), {
        id_propietario: 'user_123',
        nombre: 'Suscripciones',
        es_suscripciones: true,
        tipo_aportacion: 'flat',
        saldo_acumulado: 100,
        es_principal: false,
        activa: true,
        created_at: new Date()
      });
    });

    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const huchaRef = doc(db, 'huchas', 'sys_wallet');
    
    await assertFails(deleteDoc(huchaRef));
  });

  it('Should reject transferring ownership', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'movimientos', 'mov1'), {
        id_propietario: 'user_123',
        tipo: 'ingreso',
        concepto: 'Test',
        importe: 100,
        fecha_operacion: new Date(),
        created_at: new Date()
      });
    });

    const context = testEnv.authenticatedContext('user_123');
    const db = context.firestore();
    const movRef = doc(db, 'movimientos', 'mov1');
    
    // Trying to change ownership to user_456
    await assertFails(updateDoc(movRef, {
      id_propietario: 'user_456'
    }));
  });
});
