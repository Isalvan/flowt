import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../types';
import { getMovementWindowStart } from '../utils/periodStats';
import { useFinanceData } from './useFinanceData';

type Constraint = { field?: string; op?: string; value?: unknown; order?: string; limit?: number };
type TestQuery = { collection: string; constraints: Constraint[] };
type TestSnapshot = { docs: { id: string; data: () => Movimiento }[] };

const mocks = vi.hoisted(() => ({
  locked: false,
  authCallback: null as ((user: { uid: string } | null) => void) | null,
  getDocs: vi.fn<(query: TestQuery) => Promise<TestSnapshot>>(),
  snapshots: vi.fn(),
  windowMovements: [] as Movimiento[],
}));
vi.mock('../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: mocks.locked }) }));
vi.mock('../firebase', () => ({
  db: {},
  auth: { onAuthStateChanged: (callback: (user: { uid: string } | null) => void) => {
    mocks.authCallback = callback;
    callback({ uid: 'owner' });
    return () => {};
  } },
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, name: string) => name,
  doc: (_db: unknown, name: string) => ({ collection: name, constraints: [] }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string, order: string) => ({ field, order }),
  limit: (limit: number) => ({ limit }),
  query: (collection: string, ...constraints: Constraint[]) => ({ collection, constraints }),
  getDocs: (query: TestQuery) => query.constraints.some(c => c.op === '<')
    ? mocks.getDocs(query) : Promise.resolve({ docs: [] }),
  onSnapshot: (query: TestQuery, callback: (snapshot: unknown) => void) => {
    mocks.snapshots(query);
    if (query.collection === 'stats') {
      callback({ exists: () => true, data: () => ({ total_ingresos: 0, total_gastos: 0 }) });
    } else {
      callback({ docs: query.collection === 'movimientos'
        ? mocks.windowMovements.map(movement => ({ id: movement.id, data: () => movement })) : [] });
    }
    return () => {};
  },
}));

const movement = (id: string, date = new Date(), amount = 1): Movimiento => ({
  id, tipo: 'ingreso', concepto: id, importe: amount, fecha_operacion: date,
});
const snapshot = (movements: Movimiento[]): TestSnapshot => ({
  docs: movements.map(movement => ({ id: movement.id, data: () => movement })),
});

beforeEach(() => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key');
  mocks.locked = false;
  mocks.windowMovements = [];
  mocks.snapshots.mockClear();
  mocks.getDocs.mockReset().mockResolvedValue(snapshot([]));
  localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe('complete dashboard movement data', () => {
  it('listens to the complete date window without limit(150), keeping the recent activity limit', () => {
    mocks.windowMovements = Array.from({ length: 180 }, (_, i) => movement(String(i)));
    const { result } = renderHook(() => useFinanceData());
    const queries = mocks.snapshots.mock.calls.map(([query]) => query as TestQuery);
    const chart = queries.find(query => query.constraints.some(c => c.field === 'fecha_operacion' && c.op === '>='));
    expect(chart).toEqual({ collection: 'movimientos', constraints: [
      { field: 'id_propietario', op: '==', value: 'owner' },
      { field: 'fecha_operacion', op: '>=', value: getMovementWindowStart() },
      { field: 'fecha_operacion', order: 'desc' },
    ] });
    expect(queries.some(query => query.constraints.some(c => c.limit === 150))).toBe(false);
    expect(queries.some(query => query.constraints.some(c => c.limit === 10))).toBe(true);
    expect(result.current.chartMovements).toHaveLength(180);
    expect(result.current.chartData.at(-1)?.ingresos).toBe(180);
  });

  it('loads older movements once and clears the cache when the user changes', async () => {
    mocks.getDocs.mockResolvedValue(snapshot([movement('old', new Date(2024, 0, 1), 25)]));
    const { result } = renderHook(() => useFinanceData());
    await act(() => result.current.loadOlderMovements());
    expect(mocks.getDocs).toHaveBeenCalledWith({ collection: 'movimientos', constraints: [
      { field: 'id_propietario', op: '==', value: 'owner' },
      { field: 'fecha_operacion', op: '<', value: getMovementWindowStart() },
      { field: 'fecha_operacion', order: 'desc' },
    ] });
    expect(result.current.olderMovementsLoaded).toBe(true);
    expect(result.current.olderMovements[0]?.id).toBe('old');
    await act(() => result.current.loadOlderMovements());
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
    act(() => mocks.authCallback?.({ uid: 'another-owner' }));
    expect(result.current.olderMovements).toEqual([]);
    expect(result.current.olderMovementsLoaded).toBe(false);
    await act(() => result.current.loadOlderMovements());
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
  });

  it.each(['lock', 'sign out'] as const)('discards pending older movements on %s', async action => {
    let resolve: (value: TestSnapshot) => void = () => {};
    mocks.getDocs.mockReturnValue(new Promise<TestSnapshot>(done => { resolve = done; }));
    const { result, rerender } = renderHook(() => useFinanceData());
    let request: Promise<void> = Promise.resolve();
    act(() => { request = result.current.loadOlderMovements(); });
    expect(result.current.olderMovementsLoading).toBe(true);
    if (action === 'lock') {
      mocks.locked = true;
      rerender();
    } else {
      act(() => mocks.authCallback?.(null));
    }
    await act(async () => { resolve(snapshot([movement('old')])); await request; });
    expect(result.current.olderMovements).toEqual([]);
    expect(result.current.chartMovements).toEqual([]);
    expect(result.current.olderMovementsLoading).toBe(false);
  });

  it('reports historical load failures through the toast and error state', async () => {
    mocks.getDocs.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFinanceData());
    await act(() => result.current.loadOlderMovements());
    expect(result.current.olderMovementsError).toBe(true);
    expect(result.current.olderMovementsLoaded).toBe(false);
    expect(result.current.toast?.type).toBe('error');
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
    mocks.getDocs.mockResolvedValue(snapshot([movement('retried', new Date(2024, 0, 1), 25)]));
    await act(() => result.current.loadOlderMovements());
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(result.current.olderMovementsError).toBe(false);
    expect(result.current.olderMovementsLoaded).toBe(true);
    expect(result.current.olderMovements[0]?.id).toBe('retried');
  });

  it('keeps mock data available in demo mode without fetching older movements', async () => {
    const { result } = renderHook(() => useFinanceData(true));
    expect(result.current.chartMovements.length).toBeGreaterThan(0);
    expect(result.current.chartMovementsLoading).toBe(false);
    expect(result.current.olderMovementsLoaded).toBe(true);
    await act(() => result.current.loadOlderMovements());
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });
});
