import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hucha, Movimiento } from '../types';
import { useFinanceData } from './useFinanceData';
import { ALLOWED_UIDS } from '../shared/allowedUsers';

type Ref = { collection: string; id?: string };
type Data = Record<string, unknown>;
const store = vi.hoisted(() => ({
  docs: new Map<string, Data>(),
  listeners: [] as { ref: Ref; callback: (snapshot: unknown) => void }[],
  sequence: 0,
  deleted: Symbol('delete'),
}));
const snapshot = (ref: Ref) => ({ id: ref.id, exists: () => store.docs.has(`${ref.collection}/${ref.id}`), data: () => store.docs.get(`${ref.collection}/${ref.id}`) });
const emit = () => {
  for (const { ref, callback } of store.listeners) {
    callback(ref.id ? snapshot(ref) : { docs: [...store.docs.entries()]
      .filter(([key]) => key.startsWith(`${ref.collection}/`))
      .map(([key, data]) => ({ id: key.split('/')[1], data: () => data })) });
  }
};
vi.mock('../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false }) }));
vi.mock('../firebase', () => ({ db: {}, auth: { onAuthStateChanged: (callback: (user: { uid: string }) => void) => { callback({ uid: ALLOWED_UIDS[0] }); return () => {}; } } }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, collection: string) => ({ collection }),
  doc: (dbOrCollection: unknown, collection?: string, id?: string) => typeof collection === 'string'
    ? { collection, id } : { ...(dbOrCollection as Ref), id: `new-${++store.sequence}` },
  query: (ref: Ref) => ref,
  getDocs: async () => ({ docs: [] }),
  onSnapshot: (ref: Ref, callback: (snapshot: unknown) => void) => {
    const listener = { ref, callback };
    store.listeners.push(listener);
    emit();
    return () => { store.listeners = store.listeners.filter(item => item !== listener); };
  },
  deleteField: () => store.deleted,
  serverTimestamp: () => new Date(),
  runTransaction: async (_db: unknown, work: (tx: unknown) => Promise<void>) => {
    const writes: (() => void)[] = [];
    const put = (ref: Ref, data: Data, merge: boolean) => writes.push(() => {
      const key = `${ref.collection}/${ref.id}`;
      const next = { ...(merge ? store.docs.get(key) : {}), ...data };
      for (const field of Object.keys(next)) if (next[field] === store.deleted) delete next[field];
      store.docs.set(key, next);
    });
    await work({
      get: async (ref: Ref) => {
        if (writes.length) throw new Error('Read after write');
        return snapshot(ref);
      },
      set: (ref: Ref, data: Data, options?: { merge?: boolean }) => put(ref, data, !!options?.merge),
      update: (ref: Ref, data: Data) => put(ref, data, true),
      delete: (ref: Ref) => writes.push(() => store.docs.delete(`${ref.collection}/${ref.id}`)),
    });
    writes.forEach(write => write());
    emit();
  },
}));

const personal: Hucha = { id: 'personal', id_propietario: ALLOWED_UIDS[0], nombre: 'Personal', tipo_aportacion: 'flat', valor_aportacion: 20, saldo_acumulado: 0, objetivo: null, orden: 1, extra_importe: 100, extra_meses: [8, 12] };
const rest: Hucha = { id: 'rest', id_propietario: ALLOWED_UIDS[0], nombre: 'Resto', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 0, objetivo: null, orden: 2 };
const payroll = { tipo: 'ingreso' as const, concepto: 'Nómina', importe: 1000, fecha_operacion: '2026-08-01' };
beforeEach(() => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key');
  store.docs = new Map();
  store.listeners = [];
  store.sequence = 0;
  store.docs.set('huchas/personal', { ...personal });
  store.docs.set('huchas/rest', { ...rest });
  store.docs.set(`stats/${ALLOWED_UIDS[0]}`, { total_ingresos: 0, total_gastos: 0 });
  localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

const open = async () => {
  const hook = renderHook(() => useFinanceData());
  await waitFor(() => expect(hook.result.current.huchas).toHaveLength(2));
  return hook;
};

describe('paga extra en transacciones Firebase', () => {
  it('usa el estado fresco, escribe el mes y el reparto, borrar elimina la marca y permite repetir', async () => {
    const { result } = await open();
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    const first = result.current.movimientos[0];
    expect(store.docs.get('huchas/personal')).toMatchObject({ saldo_acumulado: 120, extra_ultimo: '2026-08' });
    expect(first.reparto_aplicado?.extras).toEqual({ personal: '2026-08' });
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    expect(store.docs.get('huchas/personal')).toMatchObject({ saldo_acumulado: 140, extra_ultimo: '2026-08' });
    await act(() => result.current.handleDeleteMovimiento(first));
    expect(store.docs.get('huchas/personal')).not.toHaveProperty('extra_ultimo');
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    expect(store.docs.get('huchas/personal')).toMatchObject({ saldo_acumulado: 140, extra_ultimo: '2026-08' });
  });

  it('la configuración se guarda y desactivar no borra el último mes', async () => {
    const { result } = await open();
    store.docs.get('huchas/personal')!.extra_ultimo = '2026-08';
    await act(() => result.current.handleCreateOrUpdateHucha({ ...personal, extra_importe: 150, extra_meses: [12, 8] }, personal.id));
    expect(store.docs.get('huchas/personal')).toMatchObject({ extra_importe: 150, extra_meses: [8, 12], extra_ultimo: '2026-08' });
    await act(() => result.current.handleCreateOrUpdateHucha({ ...personal, extra_importe: null, extra_meses: null }, personal.id));
    expect(store.docs.get('huchas/personal')).toMatchObject({ extra_importe: null, extra_meses: null, extra_ultimo: '2026-08' });
  });

  it('aprobar pendiente registra y marca la paga extra', async () => {
    const { result } = await open();
    store.docs.set('correos_pendientes/pending', { id_propietario: ALLOWED_UIDS[0], email_id: 'mail', procesado: false });
    await act(() => result.current.handleApprovePendingEmail('pending', payroll));
    expect(store.docs.get('huchas/personal')!.extra_ultimo).toBe('2026-08');
    const movement = [...store.docs.entries()].find(([key]) => key.startsWith('movimientos/'))![1] as unknown as Movimiento;
    expect(movement.reparto_aplicado?.extras).toEqual({ personal: '2026-08' });
    expect(store.docs.has('correos_pendientes/pending')).toBe(false);
  });

  it.each([false, true])('conversión sólo aplica extra en automático y su inversa la borra: manual=%s', async manual => {
    const { result } = await open();
    await act(() => result.current.handleCreateManualMovimiento({ ...payroll, tipo: 'gasto', hucha_id: 'rest' }));
    await act(() => result.current.handleConvertMovimiento(result.current.movimientos[0], manual ? [{ huchaId: 'personal', tipoAportacion: 'flat', value: 1000 }] : undefined));
    expect(store.docs.get('huchas/personal')!.extra_ultimo).toBe(manual ? undefined : '2026-08');
    await act(() => result.current.handleConvertMovimiento(result.current.movimientos[0], undefined, 'rest'));
    expect(store.docs.get('huchas/personal')).not.toHaveProperty('extra_ultimo');
  });

  it('borrar nómina antigua conserva la marca de diciembre', async () => {
    const { result } = await open();
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    const first = result.current.movimientos[0];
    await act(() => result.current.handleCreateManualMovimiento({ ...payroll, fecha_operacion: '2026-12-01' }));
    await act(() => result.current.handleDeleteMovimiento(first));
    expect(store.docs.get('huchas/personal')!.extra_ultimo).toBe('2026-12');
  });
});
