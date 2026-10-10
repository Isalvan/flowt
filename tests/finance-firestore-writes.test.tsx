import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinanceData } from '../src/hooks/useFinanceData';
import type { Hucha, Movimiento } from '../src/types';

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
  return { docs, listeners, DELETE, ref, snapshot, inCollection, write, notify, nextId: () => `nuevo-${++ids}` };
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
    where: () => ({}), orderBy: () => ({}), limit: () => ({}),
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
    getDocs: async (target: Source) => ({ docs: fake.inCollection(target.collection) }),
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
    writeBatch: () => writer(apply),
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

  it('reparte entre varias carteras y pasa al resto lo que no cabe bajo un tope', async () => {
    fake.write(fake.ref('huchas', 'viaje'), { objetivo: 100, tope_objetivo: true }, true);
    put('movimientos', 'g', gasto('g', 80, 'principal'));
    const hook = await mount();
    // 60 € pedidos para Viaje, pero solo caben 50 €; el 25 % restante va a la cartera principal.
    await act(() => hook.current.handleConvertMovimiento(gasto('g', 80, 'principal'), [
      { huchaId: 'viaje', tipoAportacion: 'flat', value: 60 },
      { huchaId: 'principal', tipoAportacion: 'porcentaje', value: 25 },
    ]));
    expect(balances()).toEqual({ principal: 100 + 80 + 20 + 10, viaje: 100 });
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
