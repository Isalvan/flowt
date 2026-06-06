import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFinanceData } from '../src/hooks/useFinanceData';
import { type Movimiento } from '../src/types';

// Mock Privacy Context
vi.mock('../src/context/PrivacyContext', () => ({
  usePrivacy: vi.fn(() => ({ isLocked: false, togglePrivacy: vi.fn() }))
}));

// Mock Firebase
vi.mock('../src/firebase', () => ({
  auth: { onAuthStateChanged: vi.fn((cb) => { cb({ uid: 'test-user' }); return () => {}; }) },
  db: {}
}));

// Mock Firebase Firestore
let mockDbData: Record<string, Movimiento> = {};

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    collection: vi.fn((db, path) => path),
    doc: vi.fn((db, path, id) => {
      if (!id) return { path, id: 'mock-id' };
      return { path: `${path}/${id}`, id };
    }),
    serverTimestamp: vi.fn(() => 'mock-timestamp'),
    deleteField: vi.fn(() => undefined), // for testing, undefined removes the key or we can check for it
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn(async () => ({ docs: [] })),
    setDoc: vi.fn(async () => {}),
    onSnapshot: vi.fn((q, cb) => {
      cb({ docs: [], exists: () => false, data: () => ({}) });
      return () => {};
    }),
    runTransaction: vi.fn(async (db, callback) => {
      const transaction = {
        get: vi.fn(async (ref) => {
          const docData = mockDbData[ref.id];
          if (!docData) return { exists: () => false, id: ref.id, ref };
          return {
            exists: () => true,
            id: ref.id,
            data: () => docData,
            ref
          };
        }),
        update: vi.fn((ref, data) => {
          mockDbData[ref.id] = { ...mockDbData[ref.id], ...data };
        }),
        set: vi.fn((ref, data) => {
          mockDbData[ref.id] = data;
        }),
        delete: vi.fn((ref) => {
          delete mockDbData[ref.id];
        })
      };
      await callback(transaction);
    })
  };
});

describe('useFinanceData M:N Linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbData = {};
    // Ensure Firebase is marked as configured
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key');
  });

  it('handles M:N linking correctly (Ingreso -> Gastos)', async () => {
    mockDbData = {
      'ing-1': { id: 'ing-1', tipo: 'ingreso', importe: 100 } as Movimiento,
      'gas-1': { id: 'gas-1', tipo: 'gasto', importe: 40, importe_neto: 40 } as Movimiento,
      'gas-2': { id: 'gas-2', tipo: 'gasto', importe: 50, importe_neto: 50 } as Movimiento,
    };

    const { result } = renderHook(() => useFinanceData(false));

    await act(async () => {
      await result.current.handleLinkMovimiento(mockDbData['ing-1'], [
        { mov: mockDbData['gas-1'], importe: 20 },
        { mov: mockDbData['gas-2'], importe: 30 }
      ]);
    });

    const ing1 = mockDbData['ing-1'];
    const gas1 = mockDbData['gas-1'];
    const gas2 = mockDbData['gas-2'];

    expect(ing1.compensaciones_destinos).toEqual([
      { gasto_id: 'gas-1', importe: 20 },
      { gasto_id: 'gas-2', importe: 30 }
    ]);
    expect(gas1.compensado_por_detalles).toEqual([{ ingreso_id: 'ing-1', importe: 20 }]);
    expect(gas1.importe_neto).toBe(20);

    expect(gas2.compensado_por_detalles).toEqual([{ ingreso_id: 'ing-1', importe: 30 }]);
    expect(gas2.importe_neto).toBe(20);
  });

  it('handles unlinking correctly with legacy compensations', async () => {
    mockDbData = {
      'ing-1': { 
        id: 'ing-1', 
        tipo: 'ingreso', 
        importe: 100,
        compensaciones_destinos: [{ gasto_id: 'gas-1', importe: 30 }]
      } as Movimiento,
      'gas-1': { 
        id: 'gas-1', 
        tipo: 'gasto', 
        importe: 50, 
        importe_neto: 10, // Originally 50. 10 legacy + 30 this link = 40 compensated -> 10 neto
        compensado_por_detalles: [{ ingreso_id: 'ing-1', importe: 30 }],
        compensado_por: ['legacy-ing'] // Some legacy connection
      } as Movimiento,
    };

    const { result } = renderHook(() => useFinanceData(false));

    await act(async () => {
      await result.current.handleUnlinkMovimiento(mockDbData['ing-1'], mockDbData['gas-1']);
    });

    const ing1 = mockDbData['ing-1'];
    const gas1 = mockDbData['gas-1'];

    expect(ing1.compensaciones_destinos).toBeUndefined(); // Assuming deleteField sets it to undefined
    expect(gas1.compensado_por_detalles).toBeUndefined();
    
    // The previous math error would have set importe_neto to 50 - 0 = 50.
    // The new correct delta-based logic should set it to 10 + 30 = 40.
    expect(gas1.importe_neto).toBe(40);
  });

  it('handles negative values and respects math max/min limits', async () => {
    // Tests what happens when the delta exceeds the boundaries
    mockDbData = {
      'ing-1': { id: 'ing-1', tipo: 'ingreso', importe: 100 } as Movimiento,
      'gas-1': { id: 'gas-1', tipo: 'gasto', importe: 20, importe_neto: 20 } as Movimiento,
    };

    const { result } = renderHook(() => useFinanceData(false));

    await act(async () => {
      // Over-compensate
      await result.current.handleLinkMovimiento(mockDbData['ing-1'], [
        { mov: mockDbData['gas-1'], importe: 30 },
      ]);
    });

    const gas1 = mockDbData['gas-1'];
    // Neto cannot be less than 0
    expect(gas1.importe_neto).toBe(0);

    // Now unlink
    await act(async () => {
      await result.current.handleUnlinkMovimiento(mockDbData['ing-1'], mockDbData['gas-1']);
    });

    const gas1After = mockDbData['gas-1'];
    // After unlink, the movement is no longer compensated by anything, so importe_neto is deleted.
    expect(gas1After.importe_neto).toBeUndefined();
  });
});
