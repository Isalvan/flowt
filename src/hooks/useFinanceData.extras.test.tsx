import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hucha } from '../types';
import { useFinanceData } from './useFinanceData';

vi.mock('../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false }) }));
const personal: Hucha = { id: 'personal', nombre: 'Personal', tipo_aportacion: 'flat', valor_aportacion: 20, saldo_acumulado: 0, objetivo: null, orden: 1, extra_importe: 100, extra_meses: [8, 12] };
const rest: Hucha = { id: 'rest', nombre: 'Resto', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 0, objetivo: null, orden: 2 };
const payroll = { tipo: 'ingreso' as const, concepto: 'Nómina', importe: 1000, fecha_operacion: '2026-08-01' };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('flowt-demo-version', '3');
  localStorage.setItem('flowt-demo-movimientos', '[]');
  localStorage.setItem('flowt-demo-huchas', JSON.stringify([personal, rest]));
  localStorage.setItem('flowt-demo-suscripciones', '[]');
  localStorage.setItem('flowt-demo-stats', JSON.stringify({ total_ingresos: 0, total_gastos: 0 }));
  localStorage.setItem('flowt-demo-pending', '[]');
});

const open = async () => {
  const hook = renderHook(() => useFinanceData(true));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe('paga extra en las operaciones web', () => {
  it('ingreso manual guarda el mes, aplica una vez y borrarlo permite repetir', async () => {
    const { result } = await open();
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    const first = result.current.movimientos[0];
    expect(first.reparto_aplicado?.extras).toEqual({ personal: '2026-08' });
    expect(result.current.huchas.find(h => h.id === 'personal')).toMatchObject({ saldo_acumulado: 120, extra_ultimo: '2026-08' });
    expect(JSON.parse(localStorage.getItem('flowt-demo-huchas')!).find((h: Hucha) => h.id === 'personal').extra_ultimo).toBe('2026-08');
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    expect(result.current.movimientos[0].reparto_aplicado).not.toHaveProperty('extras');
    await act(() => result.current.handleDeleteMovimiento(first));
    expect(result.current.huchas.find(h => h.id === 'personal')?.extra_ultimo).toBeNull();
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    expect(result.current.movimientos[0].reparto_aplicado?.extras).toEqual({ personal: '2026-08' });
  });

  it('borrar nómina antigua conserva la marca de un mes posterior', async () => {
    const { result } = await open();
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    const first = result.current.movimientos[0];
    await act(() => result.current.handleCreateManualMovimiento({ ...payroll, fecha_operacion: '2026-12-01' }));
    await act(() => result.current.handleDeleteMovimiento(first));
    expect(result.current.huchas.find(h => h.id === 'personal')?.extra_ultimo).toBe('2026-12');
  });

  it.each([{ concepto: 'Regalo' }, { hucha_id: 'personal' }])('no aplica a otros ingresos ni ingresos dirigidos %j', async fields => {
    const { result } = await open();
    await act(() => result.current.handleCreateManualMovimiento({ ...payroll, ...fields }));
    expect(result.current.huchas.find(h => h.id === 'personal')?.extra_ultimo).toBeUndefined();
  });

  it('aprobar una nómina pendiente aplica y registra la paga extra', async () => {
    const { result } = await open();
    await act(() => result.current.handleApprovePendingEmail('pending', payroll));
    expect(result.current.movimientos[0].reparto_aplicado?.extras).toEqual({ personal: '2026-08' });
    expect(result.current.huchas.find(h => h.id === 'personal')?.extra_ultimo).toBe('2026-08');
  });

  it.each([false, true])('conversión aplica sólo en reparto automático y su inversa limpia: manual=%s', async manual => {
    const { result } = await open();
    await act(() => result.current.handleCreateManualMovimiento({ ...payroll, tipo: 'gasto', hucha_id: 'rest' }));
    await act(() => result.current.handleConvertMovimiento(result.current.movimientos[0], manual ? [{ huchaId: 'personal', tipoAportacion: 'flat', value: 1000 }] : undefined));
    expect(result.current.huchas.find(h => h.id === 'personal')?.extra_ultimo).toBe(manual ? undefined : '2026-08');
    await act(() => result.current.handleConvertMovimiento(result.current.movimientos[0], undefined, 'rest'));
    expect(result.current.huchas.find(h => h.id === 'personal')?.extra_ultimo).toBe(manual ? undefined : null);
  });

  it('guardar y editar conserva la marca y persiste configuración y null', async () => {
    const { result, unmount } = await open();
    await act(() => result.current.handleCreateManualMovimiento(payroll));
    await act(() => result.current.handleCreateOrUpdateHucha({ ...personal, extra_importe: 150, extra_meses: [12, 8] }, personal.id));
    expect(result.current.huchas.find(h => h.id === 'personal')).toMatchObject({ extra_importe: 150, extra_meses: [8, 12], extra_ultimo: '2026-08' });
    await act(() => result.current.handleCreateOrUpdateHucha({ ...personal, extra_importe: null, extra_meses: null }, personal.id));
    unmount();
    const reloaded = await open();
    expect(reloaded.result.current.huchas.find(h => h.id === 'personal')).toMatchObject({ extra_importe: null, extra_meses: null, extra_ultimo: '2026-08' });
  });
});
