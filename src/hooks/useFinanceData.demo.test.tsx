import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BanksProvider } from '../context/BanksContext';
import { useBanks } from './useBanks';
import { useFinanceData } from './useFinanceData';
import { buildDemoData, sortDemoMovements } from '../utils/demoData';
import { DEMO_VERSION } from '../utils/demoStorage';
import { estimateBankBalance } from '../utils/banks';
import { roundMoney } from '../utils/incomeSplit';
import type { Movimiento } from '../types';

vi.mock('../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false }) }));
const now = new Date(2026, 9, 12, 13, 30);
const keys = ['movimientos', 'huchas', 'suscripciones', 'stats', 'pending', 'bancos'] as const;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('demo loading and persistence', () => {
  it.each([null, '1', '2'])('migrates version %s, replacing all six data keys and preserving preferences and theme', version => {
    if (version !== null) localStorage.setItem('flowt-demo-version', version);
    keys.forEach(key => localStorage.setItem(`flowt-demo-${key}`, JSON.stringify([{ id: 'legacy' }])));
    localStorage.setItem('flowt:prefs:demo', '{"inicioPeriodo":15}');
    localStorage.setItem('flowt-theme', 'dark');
    const { result } = renderHook(() => useFinanceData(true));
    const expected = buildDemoData(now);
    expect(result.current.loading).toBe(false);
    expect(localStorage.getItem('flowt-demo-version')).toBe(DEMO_VERSION);
    for (const key of keys) expect(JSON.parse(localStorage.getItem(`flowt-demo-${key}`)!)).toEqual(JSON.parse(JSON.stringify(expected[key])));
    expect(localStorage.getItem('flowt:prefs:demo')).toBe('{"inicioPeriodo":15}');
    expect(localStorage.getItem('flowt-theme')).toBe('dark');
    expect(result.current.chartMovements).toEqual(result.current.movimientos);
  });

  it('uses the same balance as the dashboard header and the sum of wallets, funded entirely by movements', () => {
    const { result } = renderHook(() => useFinanceData(true));
    const finance = result.current;
    const walletCents = finance.huchas.reduce((sum, h) => sum + Math.round(h.saldo_acumulado * 100), 0);
    expect(finance.balance).toBe(finance.totalIngresos - finance.totalGastos);
    expect(Math.round(finance.balance * 100)).toBe(walletCents);
    expect(Math.round(finance.userStats!.total_ingresos * 100) - Math.round(finance.userStats!.total_gastos * 100)).toBe(walletCents);
    expect(finance.movimientos.at(-1)?.id).toBe('m-nomina-inicial');
  });

  it('preserves current-version edits, orders stored ISO dates and seeds missing banks', () => {
    const data = buildDemoData(now);
    data.movimientos.reverse();
    data.huchas[0].nombre = 'Mi cartera';
    for (const key of keys.filter(key => key !== 'bancos')) localStorage.setItem(`flowt-demo-${key}`, JSON.stringify(data[key]));
    localStorage.setItem('flowt-demo-version', DEMO_VERSION);
    const { result, unmount } = renderHook(() => useFinanceData(true));
    expect(result.current.movimientos).toEqual(sortDemoMovements(JSON.parse(JSON.stringify(data.movimientos))));
    expect(result.current.huchas[0].nombre).toBe('Mi cartera');
    expect(JSON.parse(localStorage.getItem('flowt-demo-bancos')!)).toHaveLength(2);
    unmount();
    localStorage.setItem('flowt-demo-bancos', '[]');
    renderHook(() => useFinanceData(true));
    expect(localStorage.getItem('flowt-demo-bancos')).toBe('[]');
  });

  it('sorts activity, chart and persisted movements after adding backdated and recent manual entries', async () => {
    const { result } = renderHook(() => useFinanceData(true));
    await act(() => result.current.handleCreateManualMovimiento({ tipo: 'gasto', concepto: 'Compra anterior', importe: 10, fecha_operacion: '2026-07-15T12:00:00', hucha_id: 'h-1' }));
    expect(result.current.movimientos[0].concepto).not.toBe('Compra anterior');
    await act(() => result.current.handleCreateManualMovimiento({ tipo: 'gasto', concepto: 'Compra de hoy', importe: 5, fecha_operacion: now.toISOString(), hucha_id: 'h-1' }));
    expect(result.current.movimientos[0].concepto).toBe('Compra de hoy');
    expect(result.current.movimientos).toEqual(sortDemoMovements(result.current.movimientos));
    expect(result.current.chartMovements).toEqual(result.current.movimientos);
    const stored: Movimiento[] = JSON.parse(localStorage.getItem('flowt-demo-movimientos')!);
    expect(stored).toEqual(sortDemoMovements(stored));
    expect(stored).toEqual(JSON.parse(JSON.stringify(result.current.movimientos)));
  });

  it('loads seeded banks when entering demo with an already mounted provider', () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'configured');
    localStorage.setItem('flowt-demo-version', '2');
    localStorage.setItem('flowt-demo-bancos', JSON.stringify([{ id: 'legacy', nombre: 'Banco antiguo' }]));
    let demo = false;
    const wrapper = ({ children }: { children: React.ReactNode }) => <BanksProvider forceDemo={demo}>{children}</BanksProvider>;
    const hook = renderHook(() => ({ banks: useBanks().banks, finance: useFinanceData(demo) }), { wrapper });
    demo = true;
    hook.rerender();
    expect(hook.result.current.banks.map(b => b.nombre)).toEqual(['Revolut', 'Unicaja']);
    const bank = hook.result.current.banks.find(b => b.nombre === 'Unicaja')!;
    expect(bank.anclaFecha).toBeInstanceOf(Date);
    expect(estimateBankBalance(bank, hook.result.current.finance.chartMovements)).toBe(roundMoney(hook.result.current.finance.huchas.filter(h => !h.es_metalico).reduce((sum, h) => sum + h.saldo_acumulado, 0)));
  });
});
