import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinanceData } from '../src/hooks/useFinanceData';
import type { Hucha, Movimiento } from '../src/types';
import { getDocs, where } from 'firebase/firestore';

/**
 * Firestore en memoria para ejercitar las ramas de cuenta real del hook.
 * Las transacciones aplican sus escrituras juntas y rechazan leer después de
 * escribir, igual que Firestore.
 */
const fake = vi.hoisted(() => {
  type Data = Record<string, unknown>;
  type Ref = { kind: 'doc'; collection: string; id: string; path: string };
  const docs = new Map<string, Data>();
  const listeners = new Set<() => void>();
  const DELETE = { __op: 'delete' };
  let ids = 0;
  const ref = (collection: string, id: string): Ref => ({ kind: 'doc', collection, id, path: `${collection}/${id}` });
  const snapshot = (target: Ref) => ({
    id: target.id, ref: target, exists: () => docs.has(target.path),
    data: () => (docs.has(target.path) ? structuredClone(docs.get(target.path)) : undefined),
  });
  const inCollection = (collection: string) => [...docs.keys()]
    .filter(path => path.startsWith(`${collection}/`))
    .map(path => snapshot(ref(collection, path.slice(collection.length + 1))));
  const write = (target: Ref, values: Data, merge: boolean) => {
    const next: Data = merge ? { ...(docs.get(target.path) ?? {}) } : {};
    for (const [key, value] of Object.entries(values)) {
      if (value === DELETE) delete next[key];
      else if (value && typeof value === 'object' && '__union' in value) next[key] = Array.from(new Set([...((next[key] as unknown[]) ?? []), ...(value as { __union: unknown[] }).__union]));
      else next[key] = value;
    }
    docs.set(target.path, next);
  };
  const notify = () => listeners.forEach(listener => listener());
  return { docs, listeners, DELETE, ref, snapshot, inCollection, write, notify, batchSizes: [] as number[], nextId: () => `nuevo-${++ids}` };
});

vi.mock('firebase/firestore', () => {
  type Source = { kind: string; collection: string };
  const writer = (commit: (writes: Array<() => void>) => void) => {
    const writes: Array<() => void> = [];
    return {
      writes,
      update: (target: ReturnType<typeof fake.ref>, values: Record<string, unknown>) => {
        if (!fake.docs.has(target.path)) throw new Error(`No existe el documento ${target.path}`);
        writes.push(() => fake.write(target, values, true));
      },
      set: (target: ReturnType<typeof fake.ref>, values: Record<string, unknown>, options?: { merge?: boolean }) => writes.push(() => fake.write(target, values, !!options?.merge)),
      delete: (target: ReturnType<typeof fake.ref>) => writes.push(() => fake.docs.delete(target.path)),
      commit: async () => commit(writes),
    };
  };
  const apply = (writes: Array<() => void>) => { writes.forEach(run => run()); fake.notify(); };
  return {
    collection: (_db: unknown, name: string) => ({ kind: 'collection', collection: name }),
    query: (source: Source) => source,
    where: vi.fn(() => ({})), orderBy: () => ({}), limit: () => ({}),
    doc: (source: Source | object, ...parts: string[]) => 'kind' in source && source.kind === 'collection'
      ? fake.ref(source.collection, parts[0] ?? fake.nextId())
      : fake.ref(parts[0], parts[1]),
    serverTimestamp: () => 'ahora',
    deleteField: () => fake.DELETE,
    arrayUnion: (...values: unknown[]) => ({ __union: values }),
    onSnapshot: (target: Source & { path?: string }, next: (value: unknown) => void) => {
      const emit = () => next(target.kind === 'doc' ? fake.snapshot(target as ReturnType<typeof fake.ref>) : { docs: fake.inCollection(target.collection) });
      fake.listeners.add(emit);
      emit();
      return () => fake.listeners.delete(emit);
    },
    getDocs: vi.fn(async (target: Source) => ({ docs: fake.inCollection(target.collection) })),
    setDoc: async (target: ReturnType<typeof fake.ref>, values: Record<string, unknown>, options?: { merge?: boolean }) => { fake.write(target, values, !!options?.merge); fake.notify(); },
    runTransaction: async (_db: unknown, body: (transaction: unknown) => Promise<unknown>) => {
      const batch = writer(() => undefined);
      const result = await body({
        ...batch,
        get: async (target: ReturnType<typeof fake.ref>) => {
          if (batch.writes.length) throw new Error('Firestore exige todas las lecturas antes de la primera escritura');
          return fake.snapshot(target);
        },
      });
      apply(batch.writes);
      return result;
    },
    writeBatch: () => writer(writes => { fake.batchSizes.push(writes.length); apply(writes); }),
  };
});
vi.mock('../src/firebase', () => ({
  auth: { currentUser: { uid: 'yo' }, onAuthStateChanged: (next: (user: unknown) => void) => { next({ uid: 'yo' }); return () => {}; } },
  db: {},
}));
vi.mock('../src/context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false }) }));

const put = (collection: string, id: string, data: Record<string, unknown>) => fake.docs.set(`${collection}/${id}`, { id_propietario: 'yo', ...data });
const stored = (collection: string, id: string) => fake.docs.get(`${collection}/${id}`)!;
const balances = () => Object.fromEntries(fake.inCollection('huchas').map(h => [h.id, h.data()!.saldo_acumulado]));
const gasto = (id: string, importe: number, hucha_id: string): Movimiento => ({ id, tipo: 'gasto', concepto: 'Cena', importe, hucha_id, fecha_operacion: '2026-10-01T12:00:00Z' });

async function mount() {
  const view = renderHook(() => useFinanceData(false));
  await waitFor(() => expect(view.result.current.huchas).toHaveLength(fake.inCollection('huchas').length));
  return view.result;
}

beforeEach(() => {
  fake.docs.clear();
  fake.listeners.clear();
  fake.batchSizes.length = 0;
  localStorage.clear();
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'clave-de-prueba');
  vi.stubEnv('VITE_REVIEW_API_URL', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  put('huchas', 'principal', { nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 100, orden: 1, activa: true });
  put('huchas', 'viaje', { nombre: 'Viaje', tipo_aportacion: 'flat', valor_aportacion: 50, saldo_acumulado: 50, orden: 2, activa: true });
  put('stats', 'yo', { total_ingresos: 0, total_gastos: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each(['demo', 'firebase'] as const)('dominio común en %s', mode => {
  const ingreso = { tipo: 'ingreso' as const, concepto: 'Nómina', importe: 100, fecha_operacion: '2026-10-01' };
  const initial: Hucha[] = [
    { id: 'principal', nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 100, objetivo: null, orden: 3 },
    { id: 'llena', nombre: 'Llena', tipo_aportacion: 'flat', valor_aportacion: 80, saldo_acumulado: 100, objetivo: 100, tope_objetivo: true, orden: 1 },
    { id: 'deudora', nombre: 'Deudora', tipo_aportacion: 'flat', valor_aportacion: 30, saldo_acumulado: 20, objetivo: null, deuda_pendiente: 25, deuda_con: 'principal', orden: 2 },
    { id: 'cash', nombre: 'Efectivo', tipo_aportacion: 'flat', valor_aportacion: 1000, es_metalico: true, saldo_acumulado: 7, objetivo: null, orden: 0 },
  ];
  const record = { saldos: { deudora: 5, principal: 95 }, deudas: { deudora: { importe: 25, con: 'principal' } } };
  async function setup(wallets = initial, movements: Movimiento[] = []) {
    const pending = [{ id: 'pending', email_id: 'email', cuerpo: '', fecha_envio: '', motivo: '', procesado: false }];
    fake.docs.clear();
    wallets.forEach(h => put('huchas', h.id, { ...h }));
    movements.forEach(m => put('movimientos', m.id, { ...m }));
    put('stats', 'yo', { total_ingresos: 100, total_gastos: 100 });
    put('correos_pendientes', 'pending', pending[0]);
    localStorage.setItem('flowt-demo-huchas', JSON.stringify(wallets));
    localStorage.setItem('flowt-demo-movimientos', JSON.stringify(movements));
    localStorage.setItem('flowt-demo-suscripciones', '[]');
    localStorage.setItem('flowt-demo-stats', JSON.stringify({ total_ingresos: 100, total_gastos: 100 }));
    localStorage.setItem('flowt-demo-pending', JSON.stringify(pending));
    const view = renderHook(() => useFinanceData(mode === 'demo'));
    await waitFor(() => expect(view.result.current.huchas).toHaveLength(wallets.length));
    return view.result;
  }
  const allBalances = (hook: Awaited<ReturnType<typeof setup>>) => Object.fromEntries(hook.current.huchas.map(h => [h.id, h.saldo_acumulado]));
  const durableState = () => mode === 'demo'
    ? ['huchas', 'movimientos', 'stats', 'pending'].map(key => localStorage.getItem(`flowt-demo-${key}`))
    : structuredClone([...fake.docs]);

  it('counts and assigns missing banks across all movements, excluding cash and internal entries', async () => {
    const fields = [{}, { banco: '' }, { banco: 'Banco' }, { banco: '  ' }, { banco: 'BBVA' }, { es_metalico: true }, { es_interno: true }];
    const movements = fields.map((fields, i) => ({ ...gasto(String(i), 10, 'principal'), fecha_operacion: '2020-01-01', ...fields }));
    const hook = await setup(initial, movements);
    const before = allBalances(hook);
    expect(await hook.current.countMovimientosWithoutBank()).toBe(4);
    if (mode === 'firebase') {
      expect(where).toHaveBeenLastCalledWith('id_propietario', '==', 'yo');
      expect(vi.mocked(getDocs).mock.calls.at(-1)?.[0]).toEqual({ kind: 'collection', collection: 'movimientos' });
    }
    await act(() => hook.current.assignMovimientosWithoutBank('Revolut'));
    expect(await hook.current.countMovimientosWithoutBank()).toBe(0);
    for (let i = 0; i < 4; i++) expect(hook.current.movimientos.find(m => m.id === String(i))).toMatchObject({ banco: 'Revolut', updated_at: expect.anything() });
    expect(hook.current.movimientos.find(m => m.id === '4')?.banco).toBe('BBVA');
    expect(hook.current.movimientos.find(m => m.id === '5')).not.toHaveProperty('banco');
    expect(hook.current.movimientos.find(m => m.id === '6')).not.toHaveProperty('banco');
    expect(allBalances(hook)).toEqual(before);
  });

  it('assigns in batches of at most 400 documents', async () => {
    const hook = await setup(initial, Array.from({ length: 805 }, (_, i) => gasto(String(i), 1, 'principal')));
    await act(() => hook.current.assignMovimientosWithoutBank('BBVA'));
    expect(await hook.current.countMovimientosWithoutBank()).toBe(0);
    if (mode === 'firebase') expect(fake.batchSizes).toEqual([400, 400, 5]);
  });

  it.each([false, true])('manual movements persist a bank only for bank payments: cash=%s', async cash => {
    const hook = await setup();
    await act(() => hook.current.handleCreateManualMovimiento({ ...ingreso, banco: 'BBVA', es_metalico: cash, hucha_id: 'principal' }));
    if (cash) expect(hook.current.movimientos[0]).not.toHaveProperty('banco');
    else expect(hook.current.movimientos[0].banco).toBe('BBVA');
  });

  it('cash withdrawal legs never carry a bank', async () => {
    const hook = await setup();
    await act(() => hook.current.handleCreateManualMovimiento({ ...ingreso, importe: 10, banco: 'BBVA', es_metalico: true, es_retirada_efectivo: true, hucha_origen_id: 'principal' }));
    expect(hook.current.movimientos).toHaveLength(2);
    hook.current.movimientos.forEach(m => expect(m).not.toHaveProperty('banco'));
  });

  it.each([25.126, -125.126])('reconciliation applies signed cents without caps, stats or a bank and deletion reverses it: %s', async amount => {
    const existing: Movimiento[] = [gasto('old-expense', 100, 'principal'), { id: 'old-income', ...ingreso }];
    const hook = await setup(initial, existing);
    await waitFor(() => expect(hook.current.userStats).toEqual({ total_ingresos: 100, total_gastos: 100 }));
    const before = allBalances(hook);
    const stats = hook.current.userStats;
    const delta = Math.round(amount * 100) / 100;
    await act(() => hook.current.handleReconcileBankBalance('llena', amount));
    expect(allBalances(hook)).toEqual({ ...before, llena: Math.round((100 + delta) * 100) / 100 });
    const movement = hook.current.movimientos[0];
    expect(movement).toMatchObject({ tipo: amount > 0 ? 'ingreso' : 'gasto', concepto: 'Ajuste para cuadrar con el banco', importe: Math.abs(delta), hucha_id: 'llena', es_interno: true, fecha_operacion: expect.any(Date) });
    expect(movement).not.toHaveProperty('banco');
    expect(movement).not.toHaveProperty('reparto_aplicado');
    expect(hook.current.userStats).toEqual(stats);
    await act(() => hook.current.handleDeleteMovimiento(movement));
    expect(allBalances(hook)).toEqual(before);
    expect(hook.current.movimientos).toHaveLength(2);
    expect(hook.current.userStats).toEqual(stats);
  });

  it.each(['cash', 'missing'])('rejects reconciliation to unavailable wallets without writes: %s', async id => {
    const hook = await setup();
    const before = durableState();
    await act(async () => { await expect(hook.current.handleReconcileBankBalance(id, 20)).rejects.toThrow(); });
    expect(durableState()).toEqual(before);
  });

  it.each(['manual', 'pending'] as const)('%s respeta el tope lleno, paga deuda y guarda el registro', async operation => {
    const hook = await setup();
    const before = structuredClone(hook.current.huchas);
    await act(() => operation === 'manual' ? hook.current.handleCreateManualMovimiento(ingreso) : hook.current.handleApprovePendingEmail('pending', ingreso));
    expect(allBalances(hook)).toEqual({ principal: 195, llena: 100, deudora: 25, cash: 7 });
    expect(hook.current.huchas.find(h => h.id === 'deudora')).toMatchObject({ deuda_pendiente: 0 });
    expect(before.find(h => h.id === 'deudora')?.deuda_pendiente).toBe(25);
    expect(hook.current.movimientos[0].reparto_aplicado).toEqual(record);
    if (operation === 'pending') {
      expect(hook.current.pendingEmails).toHaveLength(0);
      if (mode === 'firebase') expect(fake.inCollection('review_handoffs')).toHaveLength(1);
    }
  });

  it('gasto→ingreso automático aplica topes después de devolver el gasto y paga deuda', async () => {
    const movement = gasto('expense', 100, 'llena');
    const hook = await setup(initial, [movement]);
    await act(() => hook.current.handleConvertMovimiento(movement));
    expect(allBalances(hook)).toEqual({ principal: 195, llena: 200, deudora: 25, cash: 7 });
    expect(hook.current.movimientos[0]).toMatchObject({ tipo: 'ingreso', reparto_aplicado: record });
    expect(hook.current.huchas.find(h => h.id === 'deudora')?.deuda_pendiente).toBe(0);
  });

  it('gasto→ingreso con filas explícitas ignora tope y deuda', async () => {
    const movement = gasto('expense', 100, 'principal');
    const hook = await setup(initial, [movement]);
    await act(() => hook.current.handleConvertMovimiento(movement, [
      { huchaId: 'llena', tipoAportacion: 'flat', value: 60 },
      { huchaId: 'deudora', tipoAportacion: 'porcentaje', value: 40 },
    ]));
    expect(allBalances(hook)).toEqual({ principal: 200, llena: 160, deudora: 60, cash: 7 });
    expect(hook.current.huchas.find(h => h.id === 'deudora')?.deuda_pendiente).toBe(25);
    expect(hook.current.movimientos[0].reparto_aplicado).toEqual({ saldos: { llena: 60, deudora: 40 }, deudas: {} });
  });

  it.each(['delete', 'convert'] as const)('%s revierte exactamente el registro aunque las reglas sean ahora inválidas', async operation => {
    const wallets = initial.map(h => h.id === 'principal' ? { ...h, saldo_acumulado: 195 } : h.id === 'deudora'
      ? { ...h, saldo_acumulado: 25, deuda_pendiente: 0, deuda_con: null, tipo_aportacion: 'porcentaje' as const, valor_aportacion: 150 } : h);
    const movement: Movimiento = { id: 'income', ...ingreso, reparto_aplicado: record };
    const hook = await setup(wallets, [movement]);
    await act(() => operation === 'delete' ? hook.current.handleDeleteMovimiento(movement) : hook.current.handleConvertMovimiento(movement, undefined, 'principal'));
    expect(allBalances(hook)).toEqual({ principal: operation === 'delete' ? 100 : 0, llena: 100, deudora: 20, cash: 7 });
    expect(hook.current.huchas.find(h => h.id === 'deudora')).toMatchObject({ deuda_pendiente: 25, deuda_con: 'principal' });
    if (operation === 'delete') expect(hook.current.movimientos).toHaveLength(0);
    else expect(hook.current.movimientos[0]).toMatchObject({ tipo: 'gasto', hucha_id: 'principal' });
  });

  it.each(['delete', 'convert'] as const)('%s de ingreso antiguo usa plain sin topes ni pagos de deuda', async operation => {
    const movement: Movimiento = { id: 'old', ...ingreso };
    const hook = await setup(initial, [movement]);
    await act(() => operation === 'delete' ? hook.current.handleDeleteMovimiento(movement) : hook.current.handleConvertMovimiento(movement, undefined, 'principal'));
    expect(allBalances(hook)).toEqual({ principal: operation === 'delete' ? 100 : 0, llena: 20, deudora: 0, cash: 7 });
    expect(hook.current.huchas.find(h => h.id === 'deudora')?.deuda_pendiente).toBe(25);
  });

  it('archivar reparte plain y deja intactas las deudas', async () => {
    const archived: Hucha = { id: 'archive', nombre: 'Archivo', tipo_aportacion: 'resto', saldo_acumulado: 100, objetivo: null, orden: 4 };
    const hook = await setup([...initial, archived]);
    await act(() => hook.current.handleDeleteHucha(archived, 'auto'));
    expect(allBalances(hook)).toEqual({ principal: 100, llena: 180, deudora: 40, cash: 7, archive: 0 });
    expect(hook.current.huchas.find(h => h.id === 'archive')?.activa).toBe(false);
    expect(hook.current.huchas.find(h => h.id === 'deudora')?.deuda_pendiente).toBe(25);
  });

  it.each(['manual', 'pending', 'convert'] as const)('%s rechaza porcentajes >100 sin ninguna escritura', async operation => {
    const wallets = initial.map(h => h.id === 'llena' || h.id === 'deudora'
      ? { ...h, tipo_aportacion: 'porcentaje' as const, valor_aportacion: h.id === 'llena' ? 70 : 40 } : h);
    const movement = gasto('expense', 100, 'principal');
    const hook = await setup(wallets, [movement]);
    const before = durableState();
    await act(async () => {
      const operationPromise = operation === 'manual' ? hook.current.handleCreateManualMovimiento(ingreso)
        : operation === 'pending' ? hook.current.handleApprovePendingEmail('pending', ingreso)
        : hook.current.handleConvertMovimiento(movement);
      await expect(operationPromise).rejects.toMatchObject({ code: 'invalid_distribution', message: expect.stringContaining('100 %') });
    });
    expect(durableState()).toEqual(before);
    expect(hook.current.movimientos[0].tipo).toBe('gasto');
    expect(hook.current.pendingEmails).toHaveLength(1);
  });

  it('filas que no suman el importe rechazan la conversión sin devolver el gasto', async () => {
    const movement = gasto('expense', 100, 'principal');
    const hook = await setup(initial, [movement]);
    const before = durableState();
    await act(async () => {
      await expect(hook.current.handleConvertMovimiento(movement, [{ huchaId: 'llena', tipoAportacion: 'flat', value: 99 }])).rejects.toMatchObject({ code: 'invalid_distribution' });
    });
    expect(durableState()).toEqual(before);
  });

  it.each(['manual', 'pending', 'convert', 'delete', 'archive'] as const)('%s sin cartera elegible no deja saldos, movimientos ni vínculos parciales', async operation => {
    const wallets = initial.map(h => ({ ...h, es_metalico: true }));
    const movement: Movimiento = operation === 'delete'
      ? { id: 'income', ...ingreso, compensa_movimiento_id: 'expense' } : gasto('expense', 100, 'principal');
    const expense: Movimiento = { ...gasto('linked-expense', 100, 'principal'), id: 'expense', compensado_por: ['income'], importe_neto: 0 };
    const hook = await setup(wallets, operation === 'delete' ? [movement, expense] : [movement]);
    const before = durableState();
    await act(async () => {
      const result = operation === 'manual' ? hook.current.handleCreateManualMovimiento(ingreso)
        : operation === 'pending' ? hook.current.handleApprovePendingEmail('pending', ingreso)
        : operation === 'convert' ? hook.current.handleConvertMovimiento(movement)
        : operation === 'delete' ? hook.current.handleDeleteMovimiento(movement)
        : hook.current.handleDeleteHucha(wallets[0], 'auto');
      await expect(result).rejects.toMatchObject({ code: 'no_hucha' });
    });
    expect(durableState()).toEqual(before);
  });

  it('los saldos de un reparto de tres céntimos se escriben redondeados', async () => {
    const wallets = initial.filter(h => h.id === 'principal' || h.id === 'deudora').map(h => ({
      ...h, deuda_pendiente: 0, saldo_acumulado: 0.005,
      ...(h.id === 'deudora' ? { tipo_aportacion: 'porcentaje' as const, valor_aportacion: 50 } : {}),
    }));
    const hook = await setup(wallets);
    await act(() => hook.current.handleCreateManualMovimiento({ ...ingreso, importe: 0.03 }));
    expect(allBalances(hook)).toEqual({ principal: 0.02, deudora: 0.03 });
    expect(hook.current.movimientos[0].reparto_aplicado).toEqual({ saldos: { deudora: 0.02, principal: 0.01 }, deudas: {} });
  });

  it('el presupuesto mensual usa topes y deudas sin escribir ni mutar carteras', async () => {
    const previous = new Date();
    previous.setMonth(previous.getMonth() - 1, 1);
    const hook = await setup(initial, [{ id: 'salary', ...ingreso, fecha_operacion: previous.toISOString() }]);
    const before = durableState();
    expect(hook.current.huchaMonthlyBudgets).toEqual(record.saldos);
    expect(hook.current.huchas.find(h => h.id === 'deudora')?.deuda_pendiente).toBe(25);
    expect(durableState()).toEqual(before);
  });

  it('las reglas inválidas dejan vacío el presupuesto sin romper la pantalla', async () => {
    const previous = new Date();
    previous.setMonth(previous.getMonth() - 1, 1);
    const wallets = initial.map(h => h.id === 'deudora' ? { ...h, tipo_aportacion: 'porcentaje' as const, valor_aportacion: 150 } : h);
    const hook = await setup(wallets, [{ id: 'salary', ...ingreso, fecha_operacion: previous.toISOString() }]);
    expect(hook.current.huchaMonthlyBudgets).toEqual({});
    expect(allBalances(hook)).toEqual({ principal: 100, llena: 100, deudora: 20, cash: 7 });
  });

  it('borrar un ingreso vinculado revierte el reparto y desvincula el gasto en la misma escritura', async () => {
    const movement: Movimiento = { id: 'income', ...ingreso, reparto_aplicado: record, compensa_movimiento_id: 'expense' };
    const expense: Movimiento = { ...gasto('expense', 100, 'principal'), compensado_por: ['income'], importe_neto: 0 };
    const hook = await setup(initial, [movement, expense]);
    await act(() => hook.current.handleDeleteMovimiento(movement));
    expect(allBalances(hook)).toEqual({ principal: 5, llena: 100, deudora: 15, cash: 7 });
    expect(hook.current.movimientos).toHaveLength(1);
    expect(hook.current.movimientos[0].compensado_por).toBeUndefined();
    expect(hook.current.movimientos[0].importe_neto).toBeUndefined();
  });

  it('archivar con reparto manual mantiene los importes elegidos', async () => {
    const archived: Hucha = { id: 'archive', nombre: 'Archivo', tipo_aportacion: 'resto', saldo_acumulado: 100, objetivo: null, orden: 4 };
    const hook = await setup([...initial, archived]);
    await act(() => hook.current.handleDeleteHucha(archived, 'manual', { llena: 60, deudora: 40 }));
    expect(allBalances(hook)).toEqual({ principal: 100, llena: 160, deudora: 60, cash: 7, archive: 0 });
  });

  it.each(['principal', 'deudora'] as const)('archivar y asignar deuda a %s cancela o transfiere según el acreedor', async assignee => {
    const archived: Hucha = { id: 'archive', nombre: 'Archivo', tipo_aportacion: 'resto', saldo_acumulado: 100, objetivo: null, orden: 4, deuda_pendiente: 50, deuda_con: 'principal' };
    const hook = await setup([...initial, archived]);
    await act(() => hook.current.handleDeleteHucha(archived, 'debt', undefined, assignee));
    expect(hook.current.huchas.find(h => h.id === 'archive')).toMatchObject({ activa: false, saldo_acumulado: 0 });
    expect(hook.current.huchas.find(h => h.id === 'deudora')).toMatchObject({ deuda_pendiente: assignee === 'deudora' ? 75 : 25, deuda_con: 'principal' });
  });

  if (mode === 'demo') {
    it('el simulador rechaza porcentajes >100 sin modificar el estado', async () => {
      const wallets = initial.map(h => h.id === 'deudora' ? { ...h, tipo_aportacion: 'porcentaje' as const, valor_aportacion: 150 } : h);
      const hook = await setup(wallets);
      const before = durableState();
      expect(() => hook.current.injectDemoMovement('ingreso', 'Nómina', 100)).toThrowError(expect.objectContaining({ code: 'invalid_distribution' }));
      expect(durableState()).toEqual(before);
    });

    it('el simulador aplica y registra el reparto, y conserva la rama de gasto', async () => {
      const hook = await setup();
      act(() => hook.current.injectDemoMovement('ingreso', 'Nómina', 100));
      expect(allBalances(hook)).toEqual({ principal: 195, llena: 100, deudora: 25, cash: 7 });
      expect(hook.current.movimientos[0].reparto_aplicado).toEqual(record);
      act(() => hook.current.injectDemoMovement('gasto', 'Compra', 10, 'deudora'));
      expect(allBalances(hook)).toEqual({ principal: 195, llena: 100, deudora: 15, cash: 7 });
    });
  } else {
    it.each(['manual', 'pending', 'convert', 'archive'] as const)('%s lee las reglas, topes y saldo actuales dentro de la transacción', async operation => {
      const movement = gasto('expense', 100, 'llena');
      const archived: Hucha = { id: 'archive', nombre: 'Archivo', tipo_aportacion: 'resto', saldo_acumulado: 100, objetivo: null, orden: 4 };
      const hook = await setup([...initial, archived], [movement]);
      // Changes have not reached the UI listener yet.
      fake.write(fake.ref('huchas', 'llena'), { saldo_acumulado: 0, valor_aportacion: 10 }, true);
      fake.write(fake.ref('huchas', 'deudora'), { valor_aportacion: 20, deuda_pendiente: 15 }, true);
      fake.write(fake.ref('huchas', 'archive'), { saldo_acumulado: 200 }, true);
      await act(() => operation === 'manual' ? hook.current.handleCreateManualMovimiento(ingreso)
        : operation === 'pending' ? hook.current.handleApprovePendingEmail('pending', ingreso)
        : operation === 'convert' ? hook.current.handleConvertMovimiento(movement)
        : hook.current.handleDeleteHucha(archived, 'auto'));
      if (operation === 'archive') {
        expect(allBalances(hook)).toEqual({ principal: 270, llena: 10, deudora: 40, cash: 7, archive: 0 });
        expect(stored('huchas', 'deudora').deuda_pendiente).toBe(15);
      } else {
        // After refund, Llena is full for conversion; otherwise it receives its updated fixed 10€.
        expect(allBalances(hook)).toEqual({ principal: operation === 'convert' ? 195 : 185, llena: operation === 'convert' ? 100 : 10, deudora: 25, cash: 7, archive: 200 });
        expect(stored('huchas', 'deudora').deuda_pendiente).toBe(0);
        expect(stored('huchas', 'deudora')).not.toHaveProperty('deuda_con');
      }
    });

    it('borrar lee el registro actual y no el que tenía la pantalla', async () => {
      const movement: Movimiento = { id: 'income', ...ingreso };
      const hook = await setup(initial, [movement]);
      fake.write(fake.ref('movimientos', movement.id), { reparto_aplicado: record }, true);
      await act(() => hook.current.handleDeleteMovimiento(movement));
      expect(allBalances(hook)).toEqual({ principal: 5, llena: 100, deudora: 15, cash: 7 });
      expect(stored('huchas', 'deudora')).toMatchObject({ deuda_pendiente: 50, deuda_con: 'principal' });
    });
  }
});

describe('convertir un gasto en ingreso con cuenta real', () => {
  it('devuelve el gasto a su cartera y reparte el ingreso', async () => {
    put('movimientos', 'g', { ...gasto('g', 40, 'viaje'), categoria: 'ocio' });
    const hook = await mount();
    await act(() => hook.current.handleConvertMovimiento(gasto('g', 40, 'viaje'), [{ huchaId: 'principal', tipoAportacion: 'resto', value: 0 }]));
    expect(balances()).toEqual({ principal: 140, viaje: 90 });
    const movimiento = stored('movimientos', 'g');
    expect(movimiento.tipo).toBe('ingreso');
    expect(movimiento).not.toHaveProperty('hucha_id');
    expect(movimiento).not.toHaveProperty('categoria');
    expect(movimiento.review_protected_fields).toEqual(['hucha_id', 'categoria']);
    expect(hook.current.toast).toEqual({ message: 'Movimiento convertido a ingreso', type: 'success' });
  });

  it('respeta el reparto explícito entre varias carteras aunque supere un tope', async () => {
    fake.write(fake.ref('huchas', 'viaje'), { objetivo: 100, tope_objetivo: true }, true);
    put('movimientos', 'g', gasto('g', 80, 'principal'));
    const hook = await mount();
    // Las filas explícitas son importes elegidos por el usuario y omiten topes y deudas.
    await act(() => hook.current.handleConvertMovimiento(gasto('g', 80, 'principal'), [
      { huchaId: 'viaje', tipoAportacion: 'flat', value: 60 },
      { huchaId: 'principal', tipoAportacion: 'porcentaje', value: 25 },
    ]));
    expect(balances()).toEqual({ principal: 100 + 80 + 20, viaje: 110 });
    expect(stored('movimientos', 'g').reparto_aplicado).toEqual({ saldos: { viaje: 60, principal: 20 }, deudas: {} });
  });

  it('usa los saldos actuales de Firestore y no los que tenía la pantalla', async () => {
    put('movimientos', 'g', gasto('g', 40, 'viaje'));
    const hook = await mount();
    // Otra sesión mueve dinero sin que esta pantalla se entere todavía.
    fake.docs.set('huchas/viaje', { ...stored('huchas', 'viaje'), saldo_acumulado: 500 });
    await act(() => hook.current.handleConvertMovimiento(gasto('g', 40, 'viaje'), [{ huchaId: 'principal', tipoAportacion: 'resto', value: 0 }]));
    expect(balances()).toEqual({ principal: 140, viaje: 540 });
  });

  it('no devuelve el dinero dos veces si el movimiento ya se había convertido', async () => {
    put('movimientos', 'g', { ...gasto('g', 40, 'viaje'), tipo: 'ingreso' });
    const hook = await mount();
    await act(() => hook.current.handleConvertMovimiento(gasto('g', 40, 'viaje'), [{ huchaId: 'principal', tipoAportacion: 'resto', value: 0 }]));
    expect(balances()).toEqual({ principal: 100, viaje: 50 });
    expect(hook.current.toast).toEqual({ message: 'Error al convertir el movimiento', type: 'error' });
  });
});

describe('las carteras archivadas no participan en repartos', () => {
  const ingreso = { tipo: 'ingreso' as const, concepto: 'Nómina', importe: 1000, fecha_operacion: '2026-10-01' };
  // Archivada, pero conserva su regla del 40 %: es lo que antes seguía recibiendo dinero.
  const archivar = (extra: Record<string, unknown> = {}) =>
    put('huchas', 'antigua', { nombre: 'Antigua', tipo_aportacion: 'porcentaje', valor_aportacion: 40, saldo_acumulado: 0, orden: 3, activa: false, ...extra });

  it('un ingreso manual se reparte solo entre las activas', async () => {
    archivar();
    const hook = await mount();
    await act(() => hook.current.handleCreateManualMovimiento(ingreso));
    expect(balances()).toEqual({ principal: 1050, viaje: 100, antigua: 0 });
  });

  it('un ingreso aprobado desde un correo pendiente se reparte solo entre las activas', async () => {
    archivar();
    put('correos_pendientes', 'correo-1', { email_id: 'correo-1', procesado: false });
    const hook = await mount();
    await act(() => hook.current.handleApprovePendingEmail('correo-1', { ...ingreso, importe: 200 }));
    expect(balances()).toEqual({ principal: 250, viaje: 100, antigua: 0 });
  });

  it('un gasto sin cartera no se carga a una principal archivada', async () => {
    archivar({ es_principal: true, orden: 0 });
    fake.write(fake.ref('huchas', 'principal'), { es_principal: false }, true);
    put('correos_pendientes', 'correo-2', { email_id: 'correo-2', procesado: false });
    const hook = await mount();
    await act(() => hook.current.handleCreateManualMovimiento({ tipo: 'gasto', concepto: 'Café', importe: 30, fecha_operacion: '2026-10-01' }));
    await act(() => hook.current.handleApprovePendingEmail('correo-2', { tipo: 'gasto', concepto: 'Cena', importe: 20, fecha_operacion: '2026-10-01' }));
    expect(balances()).toEqual({ principal: 50, viaje: 50, antigua: 0 });
  });

  it('borrar o convertir un ingreso repartido no toca las archivadas', async () => {
    archivar();
    put('movimientos', 'nomina', { id: 'nomina', ...ingreso });
    put('movimientos', 'venta', { id: 'venta', ...ingreso, concepto: 'Venta', importe: 100 });
    const hook = await mount();
    await act(() => hook.current.handleDeleteMovimiento({ id: 'nomina', ...ingreso }));
    expect(balances()).toEqual({ principal: 100 - 950, viaje: 0, antigua: 0 });
    await act(() => hook.current.handleConvertMovimiento({ id: 'venta', ...ingreso, importe: 100 }, undefined, 'viaje'));
    // Se deshace el reparto de 100 € (50 € fijos a Viaje y 50 € al resto) y el gasto sale de Viaje.
    expect(balances()).toEqual({ principal: -850 - 50, viaje: 0 - 50 - 100, antigua: 0 });
  });

  it('lo que no cabe bajo un tope no acaba en una cartera de resto archivada', async () => {
    archivar({ tipo_aportacion: 'resto', valor_aportacion: 0 });
    fake.write(fake.ref('huchas', 'principal'), { tipo_aportacion: 'flat', valor_aportacion: 0 }, true);
    fake.write(fake.ref('huchas', 'viaje'), { objetivo: 100, tope_objetivo: true }, true);
    put('huchas', 'ahorro', { nombre: 'Ahorro', tipo_aportacion: 'flat', valor_aportacion: 0, saldo_acumulado: 500, orden: 4, activa: true });
    const hook = await mount();
    await act(() => hook.current.handleTransfer('ahorro', 'viaje', 80));
    expect(balances()).toEqual({ principal: 130, viaje: 100, antigua: 0, ahorro: 420 });
  });

  it('en la demo tampoco reciben ingresos ni presupuesto', async () => {
    const carteras = [
      { id: 'principal', nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 100, objetivo: null, orden: 1 },
      { id: 'viaje', nombre: 'Viaje', tipo_aportacion: 'flat', valor_aportacion: 50, saldo_acumulado: 50, objetivo: null, orden: 2 },
      { id: 'antigua', nombre: 'Antigua', tipo_aportacion: 'porcentaje', valor_aportacion: 40, saldo_acumulado: 0, objetivo: null, orden: 3, activa: false },
    ];
    localStorage.setItem('flowt-demo-huchas', JSON.stringify(carteras));
    localStorage.setItem('flowt-demo-movimientos', JSON.stringify([{ id: 'previo', ...ingreso, fecha_operacion: '2026-09-01T10:00:00Z' }]));
    localStorage.setItem('flowt-demo-suscripciones', '[]');
    localStorage.setItem('flowt-demo-stats', JSON.stringify({ total_ingresos: 1000, total_gastos: 0 }));
    localStorage.setItem('flowt-demo-pending', JSON.stringify([{ id: 'correo-3', email_id: 'correo-3', cuerpo: '', fecha_envio: '', motivo: '', procesado: false }]));
    const view = renderHook(() => useFinanceData(true));
    await waitFor(() => expect(view.result.current.huchas).toHaveLength(3));
    const saldos = () => Object.fromEntries(view.result.current.huchas.map(h => [h.id, h.saldo_acumulado]));
    expect(view.result.current.huchaMonthlyBudgets).toEqual({ viaje: 50, principal: 950 });
    await act(() => view.result.current.handleCreateManualMovimiento(ingreso));
    expect(saldos()).toEqual({ principal: 1050, viaje: 100, antigua: 0 });
    await act(() => view.result.current.handleApprovePendingEmail('correo-3', { ...ingreso, importe: 200 }));
    expect(saldos()).toEqual({ principal: 1200, viaje: 150, antigua: 0 });
    const manual = view.result.current.movimientos.find(m => m.importe === 1000 && m.id !== 'previo')!;
    await act(() => view.result.current.handleDeleteMovimiento(manual));
    expect(saldos()).toEqual({ principal: 250, viaje: 100, antigua: 0 });
  });
});

describe('devolver un gasto cuya cartera está archivada', () => {
  const todoAPrincipal = [{ huchaId: 'principal', tipoAportacion: 'resto' as const, value: 0 }];
  const archivarViaje = () => fake.write(fake.ref('huchas', 'viaje'), { activa: false, saldo_acumulado: 0 }, true);

  it('al borrarlo, el dinero vuelve a la cartera principal', async () => {
    archivarViaje();
    put('movimientos', 'g', gasto('g', 40, 'viaje'));
    const hook = await mount();
    await act(() => hook.current.handleDeleteMovimiento(gasto('g', 40, 'viaje')));
    expect(balances()).toEqual({ principal: 140, viaje: 0 });
    expect(fake.docs.has('movimientos/g')).toBe(false);
  });

  it('al convertirlo en ingreso, también', async () => {
    archivarViaje();
    put('movimientos', 'g', gasto('g', 40, 'viaje'));
    const hook = await mount();
    await act(() => hook.current.handleConvertMovimiento(gasto('g', 40, 'viaje'), todoAPrincipal));
    expect(balances()).toEqual({ principal: 100 + 40 + 40, viaje: 0 });
  });

  it('si su cartera sigue activa, vuelve a ella', async () => {
    put('movimientos', 'g', gasto('g', 40, 'viaje'));
    const hook = await mount();
    await act(() => hook.current.handleDeleteMovimiento(gasto('g', 40, 'viaje')));
    expect(balances()).toEqual({ principal: 100, viaje: 90 });
  });

  it('en la demo se comporta igual', async () => {
    const carteras = [
      { id: 'principal', nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 100, objetivo: null, orden: 1 },
      { id: 'viaje', nombre: 'Viaje', tipo_aportacion: 'flat', valor_aportacion: 50, saldo_acumulado: 0, objetivo: null, orden: 2, activa: false },
    ];
    localStorage.setItem('flowt-demo-huchas', JSON.stringify(carteras));
    localStorage.setItem('flowt-demo-movimientos', JSON.stringify([gasto('g1', 40, 'viaje'), gasto('g2', 25, 'viaje')]));
    localStorage.setItem('flowt-demo-suscripciones', '[]');
    localStorage.setItem('flowt-demo-stats', JSON.stringify({ total_ingresos: 0, total_gastos: 65 }));
    localStorage.setItem('flowt-demo-pending', '[]');
    const view = renderHook(() => useFinanceData(true));
    await waitFor(() => expect(view.result.current.huchas).toHaveLength(2));
    const saldos = () => Object.fromEntries(view.result.current.huchas.map(h => [h.id, h.saldo_acumulado]));
    await act(() => view.result.current.handleDeleteMovimiento(gasto('g1', 40, 'viaje')));
    expect(saldos()).toEqual({ principal: 140, viaje: 0 });
    await act(() => view.result.current.handleConvertMovimiento(gasto('g2', 25, 'viaje'), todoAPrincipal));
    expect(saldos()).toEqual({ principal: 140 + 25 + 25, viaje: 0 });
  });
});

describe('convertir un ingreso en gasto', () => {
  const ingreso = (id: string, importe: number, hucha_id?: string): Movimiento =>
    ({ id, tipo: 'ingreso', concepto: 'Bizum', importe, fecha_operacion: '2026-10-01T12:00:00Z', ...(hucha_id ? { hucha_id } : {}) });

  it('no carga el gasto dos veces si el movimiento ya se había convertido', async () => {
    put('movimientos', 'i', { ...ingreso('i', 40), tipo: 'gasto', hucha_id: 'viaje' });
    const hook = await mount();
    await act(() => hook.current.handleConvertMovimiento(ingreso('i', 40), undefined, 'viaje'));
    expect(balances()).toEqual({ principal: 100, viaje: 50 });
    expect(hook.current.toast).toEqual({ message: 'Error al convertir el movimiento', type: 'error' });
  });

  it('tampoco lo aplica si el importe ha cambiado desde que se abrió la pantalla', async () => {
    put('movimientos', 'i', ingreso('i', 75));
    const hook = await mount();
    await act(() => hook.current.handleConvertMovimiento(ingreso('i', 40), undefined, 'viaje'));
    expect(balances()).toEqual({ principal: 100, viaje: 50 });
    expect(stored('movimientos', 'i').tipo).toBe('ingreso');
  });

  it('un ingreso hecho a una cartera concreta se deshace de esa cartera', async () => {
    put('movimientos', 'i', ingreso('i', 100, 'viaje'));
    const hook = await mount();
    await act(() => hook.current.handleConvertMovimiento(ingreso('i', 100, 'viaje'), undefined, 'principal'));
    // Sale de Viaje el ingreso que entró allí y el gasto se carga a la principal.
    expect(balances()).toEqual({ principal: 0, viaje: -50 });
    expect(stored('movimientos', 'i')).toMatchObject({ tipo: 'gasto', hucha_id: 'principal' });
  });

  it('un ingreso repartido se sigue deshaciendo según las reglas de las carteras', async () => {
    put('movimientos', 'i', ingreso('i', 100));
    const hook = await mount();
    await act(() => hook.current.handleConvertMovimiento(ingreso('i', 100), undefined, 'principal'));
    expect(balances()).toEqual({ principal: 100 - 50 - 100, viaje: 0 });
  });

  it('en la demo también respeta la cartera del ingreso', async () => {
    const carteras = [
      { id: 'principal', nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 100, objetivo: null, orden: 1 },
      { id: 'viaje', nombre: 'Viaje', tipo_aportacion: 'flat', valor_aportacion: 50, saldo_acumulado: 50, objetivo: null, orden: 2 },
    ];
    localStorage.setItem('flowt-demo-huchas', JSON.stringify(carteras));
    localStorage.setItem('flowt-demo-movimientos', JSON.stringify([ingreso('i', 100, 'viaje')]));
    localStorage.setItem('flowt-demo-suscripciones', '[]');
    localStorage.setItem('flowt-demo-stats', JSON.stringify({ total_ingresos: 100, total_gastos: 0 }));
    localStorage.setItem('flowt-demo-pending', '[]');
    const view = renderHook(() => useFinanceData(true));
    await waitFor(() => expect(view.result.current.huchas).toHaveLength(2));
    await act(() => view.result.current.handleConvertMovimiento(ingreso('i', 100, 'viaje'), undefined, 'principal'));
    expect(Object.fromEntries(view.result.current.huchas.map(h => [h.id, h.saldo_acumulado]))).toEqual({ principal: 0, viaje: -50 });
  });
});

describe('préstamo entre carteras', () => {
  const cartera = { nombre: 'Viaje', tipo_aportacion: 'flat' as const, valor_aportacion: 50, objetivo: null, es_principal: false, tope_objetivo: false };

  it('se guarda al editar y al crear una cartera con cuenta real', async () => {
    const hook = await mount();
    await act(() => hook.current.handleCreateOrUpdateHucha({ ...cartera, subsanar_hasta: 200, subsanar_con: 'principal' }, 'viaje'));
    expect(stored('huchas', 'viaje')).toMatchObject({ subsanar_hasta: 200, subsanar_con: 'principal', saldo_acumulado: 50 });
    await act(() => hook.current.handleCreateOrUpdateHucha({ ...cartera, nombre: 'Imprevistos', subsanar_hasta: 75, subsanar_con: null }, null));
    const creada = fake.inCollection('huchas').map(h => h.data()!).find(h => h.nombre === 'Imprevistos')!;
    expect(creada).toMatchObject({ subsanar_hasta: 75, subsanar_con: null, saldo_acumulado: 0, id_propietario: 'yo' });
    // El botón de subsanar depende de estos dos campos.
    await waitFor(() => expect(hook.current.huchas.find(h => h.id === 'viaje')?.subsanar_hasta).toBe(200));
    await act(() => hook.current.handleSubsanarHucha(hook.current.huchas.find(h => h.id === 'viaje') as Hucha));
    expect(balances()).toMatchObject({ principal: -50, viaje: 200 });
    expect(stored('huchas', 'viaje')).toMatchObject({ deuda_pendiente: 150, deuda_con: 'principal' });
  });

  it('se conserva si una edición no la envía', async () => {
    fake.write(fake.ref('huchas', 'viaje'), { subsanar_hasta: 120, subsanar_con: 'principal' }, true);
    const hook = await mount();
    await act(() => hook.current.handleCreateOrUpdateHucha({ ...cartera, nombre: 'Japón' }, 'viaje'));
    expect(stored('huchas', 'viaje')).toMatchObject({ nombre: 'Japón', subsanar_hasta: 120, subsanar_con: 'principal' });
  });

  it('se guarda también en la demo', async () => {
    const view = renderHook(() => useFinanceData(true));
    await waitFor(() => expect(view.result.current.huchas.length).toBeGreaterThan(1));
    const [prestamista, editada] = view.result.current.huchas;
    await act(() => view.result.current.handleCreateOrUpdateHucha({ ...cartera, subsanar_hasta: 300, subsanar_con: prestamista.id }, editada.id));
    await act(() => view.result.current.handleCreateOrUpdateHucha({ ...cartera, nombre: 'Imprevistos', subsanar_hasta: 40, subsanar_con: null }, null));
    expect(view.result.current.huchas.find(h => h.id === editada.id)).toMatchObject({ subsanar_hasta: 300, subsanar_con: prestamista.id });
    expect(view.result.current.huchas.find(h => h.nombre === 'Imprevistos')).toMatchObject({ subsanar_hasta: 40, subsanar_con: null });
  });
});
