import { act, renderHook, render, screen, cleanup } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../types';
import { getMovementWindowStart } from '../utils/periodStats';
import { useFinanceData } from './useFinanceData';
import { ALLOWED_UIDS } from '../shared/allowedUsers';

type Constraint = { field?: string; op?: string; value?: unknown; order?: string; limit?: number };
type TestQuery = { collection: string; constraints: Constraint[] };
type TestSnapshot = { docs: { id: string; data: () => Movimiento }[] };
type OlderListener = {
  query: TestQuery;
  snapshot: (snapshot: TestSnapshot) => void;
  error: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  locked: false,
  authCallback: null as ((user: { uid: string } | null) => void) | null,
  getDocs: vi.fn<(query: TestQuery) => Promise<TestSnapshot>>(),
  snapshots: vi.fn(),
  olderListeners: [] as OlderListener[],
  windowMovements: [] as Movimiento[],
}));
vi.mock('../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: mocks.locked }) }));
vi.mock('../firebase', () => ({
  db: {},
  auth: { onAuthStateChanged: (callback: (user: { uid: string } | null) => void) => {
    mocks.authCallback = callback;
    callback({ uid: ALLOWED_UIDS[0] });
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
  getDocs: (query: TestQuery) => mocks.getDocs(query),
  onSnapshot: (query: TestQuery, callback: (snapshot: unknown) => void, error?: (error: Error) => void) => {
    mocks.snapshots(query);
    if (query.constraints.some(c => c.op === '<')) {
      if (!error) throw new Error('Missing older listener error handler');
      const unsubscribe = vi.fn();
      mocks.olderListeners.push({ query, snapshot: callback, error, unsubscribe });
      return unsubscribe;
    }
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
  mocks.olderListeners = [];
  mocks.snapshots.mockClear();
  mocks.getDocs.mockReset().mockResolvedValue(snapshot([]));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('complete dashboard movement data', () => {
  it('keeps one older listener active when a child requests history under StrictMode', () => {
    const Child = ({ finance }: { finance: ReturnType<typeof useFinanceData> }) => {
      const { loadOlderMovements } = finance;
      useEffect(() => { void loadOlderMovements(); }, [loadOlderMovements]);
      return <output>{finance.olderMovements.map(m => m.concepto).join(', ')}</output>;
    };
    const Consumer = () => {
      const finance = useFinanceData();
      return <Child finance={finance} />;
    };
    const { unmount } = render(<StrictMode><Consumer /></StrictMode>);
    const active = mocks.olderListeners.filter(listener => listener.unsubscribe.mock.calls.length === 0);
    expect(active).toHaveLength(1);
    act(() => active[0].snapshot(snapshot([movement('strict-history')])));
    expect(screen.getByText('strict-history')).toBeInTheDocument();
    expect(mocks.olderListeners.filter(listener => listener.unsubscribe.mock.calls.length === 0)).toHaveLength(1);
    unmount();
    expect(mocks.olderListeners.every(listener => listener.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('listens to the complete date window without limit(150), keeping the recent activity limit', () => {
    mocks.windowMovements = Array.from({ length: 180 }, (_, i) => movement(String(i)));
    const { result } = renderHook(() => useFinanceData());
    const queries = mocks.snapshots.mock.calls.map(([query]) => query as TestQuery);
    const chart = queries.find(query => query.constraints.some(c => c.field === 'fecha_operacion' && c.op === '>='));
    expect(chart).toEqual({ collection: 'movimientos', constraints: [
      { field: 'id_propietario', op: '==', value: ALLOWED_UIDS[0] },
      { field: 'fecha_operacion', op: '>=', value: getMovementWindowStart() },
      { field: 'fecha_operacion', order: 'desc' },
    ] });
    expect(queries.some(query => query.constraints.some(c => c.limit === 150))).toBe(false);
    expect(queries.some(query => query.constraints.some(c => c.limit === 10))).toBe(true);
    expect(result.current.chartMovements).toHaveLength(180);
    expect(result.current.chartData.at(-1)?.ingresos).toBe(180);
  });

  it('subscribes to older movements once and clears them when the user changes', async () => {
    const { result } = renderHook(() => useFinanceData());
    await act(() => result.current.loadOlderMovements());
    expect(mocks.olderListeners[0].query).toEqual({ collection: 'movimientos', constraints: [
      { field: 'id_propietario', op: '==', value: ALLOWED_UIDS[0] },
      { field: 'fecha_operacion', op: '<', value: getMovementWindowStart() },
      { field: 'fecha_operacion', order: 'desc' },
    ] });
    expect(result.current.olderMovementsLoading).toBe(true);
    expect(result.current.olderMovementsLoaded).toBe(false);
    await act(() => result.current.loadOlderMovements());
    expect(mocks.olderListeners).toHaveLength(1);
    act(() => mocks.olderListeners[0].snapshot(snapshot([movement('old', new Date(2024, 0, 1), 25)])));
    expect(result.current.olderMovementsLoading).toBe(false);
    expect(result.current.olderMovementsLoaded).toBe(true);
    expect(result.current.olderMovements[0]?.id).toBe('old');
    await act(() => result.current.loadOlderMovements());
    expect(mocks.olderListeners).toHaveLength(1);
    act(() => mocks.authCallback?.({ uid: ALLOWED_UIDS[1] }));
    expect(mocks.olderListeners[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.olderMovements).toEqual([]);
    expect(result.current.olderMovementsLoaded).toBe(false);
    await act(() => result.current.loadOlderMovements());
    expect(mocks.olderListeners).toHaveLength(2);
    expect(mocks.olderListeners[1].query.constraints).toContainEqual({ field: 'id_propietario', op: '==', value: ALLOWED_UIDS[1] });
    expect(mocks.getDocs.mock.calls.some(([query]) => query.constraints.some(c => c.op === '<'))).toBe(false);
  });

  it.each(['lock', 'sign out', 'unmount'] as const)('unsubscribes from pending older movements on %s', async action => {
    const { result, rerender, unmount } = renderHook(() => useFinanceData());
    await act(() => result.current.loadOlderMovements());
    expect(result.current.olderMovementsLoading).toBe(true);
    if (action === 'lock') {
      mocks.locked = true;
      rerender();
    } else if (action === 'sign out') {
      act(() => mocks.authCallback?.(null));
    } else {
      unmount();
    }
    expect(mocks.olderListeners[0].unsubscribe).toHaveBeenCalledTimes(1);
    act(() => mocks.olderListeners[0].snapshot(snapshot([movement('old')])));
    if (action === 'unmount') return;
    expect(result.current.olderMovements).toEqual([]);
    expect(result.current.chartMovements).toEqual([]);
    expect(result.current.olderMovementsLoading).toBe(false);
  });

  it('updates changed concepts and removed movements on subsequent snapshots', async () => {
    const { result } = renderHook(() => useFinanceData());
    await act(() => result.current.loadOlderMovements());
    const old = movement('old', new Date(2024, 0, 1), 25);
    act(() => mocks.olderListeners[0].snapshot(snapshot([old, movement('deleted')])));
    expect(result.current.olderMovements).toHaveLength(2);
    const edited = { ...old, concepto: 'Concepto corregido', categoria: 'otros', compensado_por: [], importe_neto: 25 };
    act(() => mocks.olderListeners[0].snapshot(snapshot([edited])));
    expect(result.current.olderMovements).toEqual([edited]);
    expect(result.current.olderMovementsLoaded).toBe(true);
    expect(result.current.olderMovementsLoading).toBe(false);
    expect(mocks.olderListeners).toHaveLength(1);
  });

  it('reports listener failures and subscribes again on retry', async () => {
    const { result } = renderHook(() => useFinanceData());
    await act(() => result.current.loadOlderMovements());
    act(() => mocks.olderListeners[0].error(new Error('offline')));
    expect(result.current.olderMovementsError).toBe(true);
    expect(result.current.olderMovementsLoaded).toBe(false);
    expect(result.current.olderMovementsLoading).toBe(false);
    expect(result.current.toast?.type).toBe('error');
    expect(mocks.olderListeners[0].unsubscribe).toHaveBeenCalledTimes(1);
    await act(() => result.current.loadOlderMovements());
    expect(mocks.olderListeners).toHaveLength(2);
    expect(result.current.olderMovementsLoading).toBe(true);
    expect(result.current.olderMovementsError).toBe(false);
    act(() => mocks.olderListeners[1].snapshot(snapshot([movement('retried', new Date(2024, 0, 1), 25)])));
    expect(result.current.olderMovementsError).toBe(false);
    expect(result.current.olderMovementsLoaded).toBe(true);
    expect(result.current.olderMovements[0]?.id).toBe('retried');
  });

  it('keeps already loaded rows available while a failed listener is retried', async () => {
    const { result } = renderHook(() => useFinanceData());
    await act(() => result.current.loadOlderMovements());
    const old = movement('old');
    act(() => mocks.olderListeners[0].snapshot(snapshot([old])));
    act(() => mocks.olderListeners[0].error(new Error('offline')));
    expect(result.current.olderMovements).toEqual([old]);
    expect(result.current.olderMovementsError).toBe(true);
    await act(() => result.current.loadOlderMovements());
    expect(result.current.olderMovements).toEqual([old]);
    expect(result.current.olderMovementsLoading).toBe(true);
    act(() => mocks.olderListeners[1].snapshot(snapshot([])));
    expect(result.current.olderMovements).toEqual([]);
    expect(result.current.olderMovementsLoaded).toBe(true);
  });

  it('keeps mock data available in demo mode without fetching older movements', async () => {
    const { result } = renderHook(() => useFinanceData(true));
    expect(result.current.chartMovements.length).toBeGreaterThan(0);
    expect(result.current.chartMovementsLoading).toBe(false);
    expect(result.current.olderMovementsLoaded).toBe(true);
    await act(() => result.current.loadOlderMovements());
    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(mocks.snapshots).not.toHaveBeenCalled();
  });
});
