import { StrictMode } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BanksProvider } from './BanksContext';
import { useBanks } from '../hooks/useBanks';
import { onAuthStateChanged } from 'firebase/auth';

const mocks = vi.hoisted(() => ({ locked: false, snapshot: vi.fn(), unsubscribe: vi.fn(), authOff: vi.fn(), set: vi.fn(), update: vi.fn(), delete: vi.fn(), exists: false,
  success: null as null | ((snapshot: { docs: { id: string; data: () => { nombre: string; ancla_saldo?: number; ancla_fecha?: { toDate: () => Date }; ultimo_desfase?: number | null } }[] }) => void),
  error: null as null | (() => void),
}));
vi.mock('./PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: mocks.locked }) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth, cb) => { cb({ uid: 'owner' }); return mocks.authOff; }) }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...parts) => parts.join('/')), doc: vi.fn((_db, ...parts) => parts.join('/')),
  serverTimestamp: () => 'server-time', deleteDoc: mocks.delete,
  updateDoc: mocks.update,
  onSnapshot: (...args: unknown[]) => { mocks.snapshot(...args); mocks.success = args[1] as typeof mocks.success; mocks.error = args[2] as typeof mocks.error; return mocks.unsubscribe; },
  runTransaction: async (_db: unknown, cb: (t: unknown) => Promise<void>) => cb({ get: async () => ({ exists: () => mocks.exists }), set: mocks.set }),
}));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.locked = false; mocks.exists = false; vi.stubEnv('VITE_FIREBASE_API_KEY', 'configured'); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('BanksProvider', () => {
  it('persists the demo anchor including its Date and discrepancy across remounts', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <BanksProvider forceDemo>{children}</BanksProvider>;
    const hook = renderHook(useBanks, { wrapper });
    await act(async () => { await hook.result.current.addBank('bbva'); await hook.result.current.anchorBank('bbva', 125.75, null); });
    const firstDate = hook.result.current.banks[0].anclaFecha;
    expect(firstDate).toBeInstanceOf(Date);
    expect(hook.result.current.banks[0]).toMatchObject({ anclaSaldo: 125.75, ultimoDesfase: null });
    await act(async () => { await hook.result.current.anchorBank('bbva', 120, -5.75); });
    hook.unmount();
    const restored = renderHook(useBanks, { wrapper });
    expect(restored.result.current.banks[0]).toMatchObject({ anclaSaldo: 120, ultimoDesfase: -5.75 });
    expect(restored.result.current.banks[0].anclaFecha).toBeInstanceOf(Date);
  });
  it('writes only the anchor fields and server timestamps to the owner bank', async () => {
    const hook = renderHook(useBanks, { wrapper: ({ children }) => <BanksProvider>{children}</BanksProvider> });
    await act(async () => { await hook.result.current.addBank('bbva'); });
    await act(async () => { await hook.result.current.anchorBank('bbva', 120, -5); });
    expect(mocks.update).toHaveBeenCalledWith('bancos/owner/items/bbva', { ancla_saldo: 120, ancla_fecha: 'server-time', ultimo_desfase: -5, updated_at: 'server-time' });
    const date = new Date('2026-10-11T10:00:00Z');
    act(() => { mocks.success?.({ docs: [{ id: 'bbva', data: () => ({ nombre: 'BBVA', ancla_saldo: 120, ancla_fecha: { toDate: () => date }, ultimo_desfase: -5 }) }] }); });
    expect(hook.result.current.banks[0]).toMatchObject({ anclaSaldo: 120, anclaFecha: date, ultimoDesfase: -5 });
    await expect(hook.result.current.anchorBank('bbva', Infinity, null)).rejects.toThrow('válido');
    mocks.locked = true; hook.rerender();
    await expect(hook.result.current.anchorBank('bbva', 10, null)).rejects.toThrow('Desbloquea');
  });
  it('adds catalog and custom banks, rejects duplicates, sorts, removes and persists demo data', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <StrictMode><BanksProvider forceDemo>{children}</BanksProvider></StrictMode>;
    const hook = renderHook(useBanks, { wrapper });
    await act(async () => { await hook.result.current.addBank('unicaja'); await hook.result.current.addBank('Ábaco'); });
    expect(hook.result.current.banks.map(b => b.nombre)).toEqual(['Ábaco', 'Unicaja']);
    expect(hook.result.current.banks[0].id).toMatch(/^custom_[a-f0-9]{64}$/);
    await expect(hook.result.current.addBank('abaco')).rejects.toThrow('Ya tienes ese banco');
    await expect(hook.result.current.addBank('UNICÁJA')).rejects.toThrow('Ya tienes ese banco');
    await act(async () => { await hook.result.current.removeBank('unicaja'); });
    hook.unmount();
    const restored = renderHook(useBanks, { wrapper });
    expect(restored.result.current.banks.map(b => b.nombre)).toEqual(['Ábaco']);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('hides demo banks while locked and rejects changes', async () => {
    localStorage.setItem('flowt-demo-bancos', JSON.stringify([{ id: 'unicaja', nombre: 'Unicaja' }]));
    mocks.locked = true;
    const hook = renderHook(useBanks, { wrapper: ({ children }) => <BanksProvider forceDemo>{children}</BanksProvider> });
    expect(hook.result.current.banks).toEqual([]);
    await expect(hook.result.current.addBank('revolut')).rejects.toThrow('Desbloquea');
    await expect(hook.result.current.removeBank('unicaja')).rejects.toThrow('Desbloquea');
    mocks.locked = false; hook.rerender();
    expect(hook.result.current.banks).toHaveLength(1);
  });
  it('uses owner paths and transactions, handles listener errors and cleans up in StrictMode', async () => {
    const hook = renderHook(useBanks, { wrapper: ({ children }) => <StrictMode><BanksProvider>{children}</BanksProvider></StrictMode> });
    expect(mocks.snapshot).toHaveBeenLastCalledWith('bancos/owner/items', expect.any(Function), expect.any(Function));
    await act(async () => { await hook.result.current.addBank('bbva'); });
    expect(mocks.set).toHaveBeenCalledWith('bancos/owner/items/bbva', { nombre: 'BBVA', created_at: 'server-time' });
    act(() => { mocks.success?.({ docs: [{ id: 'bbva', data: () => ({ nombre: 'BBVA' }) }] }); });
    expect(hook.result.current.banks).toHaveLength(1);
    await act(async () => { await hook.result.current.removeBank('bbva'); });
    expect(mocks.delete).toHaveBeenCalledWith('bancos/owner/items/bbva');
    act(() => { mocks.error?.(); });
    expect(hook.result.current.banks).toEqual([]);
    mocks.exists = true;
    await expect(hook.result.current.addBank('bbva')).rejects.toThrow('Ya tienes ese banco');
    hook.unmount();
    expect(mocks.unsubscribe.mock.calls.length).toBe(mocks.snapshot.mock.calls.length);
    expect(mocks.authOff).toHaveBeenCalledTimes(vi.mocked(onAuthStateChanged).mock.calls.length);
  });
  it('offers empty no-op defaults without a provider', async () => {
    const hook = renderHook(useBanks);
    expect(hook.result.current.banks).toEqual([]);
    await hook.result.current.addBank('bbva'); await hook.result.current.removeBank('bbva');
  });
  it('does not subscribe while locked', () => {
    mocks.locked = true;
    render(<BanksProvider><span /></BanksProvider>);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
});
