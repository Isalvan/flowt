import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinanceData } from './useFinanceData';
import { suggestCompensations } from '../utils/movementSuggestions';

vi.mock('../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false }) }));
const initial = [
  { id: 'g', tipo: 'gasto', concepto: 'Restaurante', importe: 60, fecha_operacion: '2026-05-12T12:00:00+02:00' },
  { id: 'i', tipo: 'ingreso', concepto: 'Persona de ejemplo', importe: 30, fecha_operacion: '2026-05-12T13:00:00+02:00' },
];
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('flowt-demo-movimientos', JSON.stringify(initial));
  localStorage.setItem('flowt-demo-huchas', '[]');
  localStorage.setItem('flowt-demo-suscripciones', '[]');
  localStorage.setItem('flowt-demo-stats', JSON.stringify({ total_ingresos: 30, total_gastos: 60 }));
  localStorage.setItem('flowt-demo-pending', '[]');
});

describe('persistencia de propuestas en demo', () => {
  it('conserva categorías confirmadas y rechazos al recargar', async () => {
    const { result, unmount } = renderHook(() => useFinanceData(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.handleUpdateMovimientoCategoria('g', 'restaurantes'));
    await act(() => result.current.handleDismissCompensation('i', 'g'));
    unmount();
    const reloaded = renderHook(() => useFinanceData(true));
    await waitFor(() => expect(reloaded.result.current.loading).toBe(false));
    expect(reloaded.result.current.movimientos.find(m => m.id === 'g')?.categoria).toBe('restaurantes');
    expect(suggestCompensations(reloaded.result.current.movimientos)).toHaveLength(0);
  });
  it('solo vincula tras aceptar y no permite repetir la aceptación', async () => {
    const { result } = renderHook(() => useFinanceData(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(suggestCompensations(result.current.movimientos)).toHaveLength(1);
    const [g, i] = result.current.movimientos;
    await act(() => result.current.handleLinkMovimiento(i, [{ mov: g, importe: 30 }]));
    expect(result.current.movimientos.find(m => m.id === 'g')?.importe_neto).toBe(30);
    expect(suggestCompensations(result.current.movimientos)).toHaveLength(0);
    await act(async () => { await expect(result.current.handleLinkMovimiento(i, [{ mov: g, importe: 30 }])).rejects.toThrow(); });
    expect(result.current.movimientos.find(m => m.id === 'g')?.importe_neto).toBe(30);
    await act(() => result.current.handleUnlinkMovimiento(result.current.movimientos.find(m => m.id === 'i')!));
    expect(result.current.movimientos.find(m => m.id === 'g')?.importe_neto).toBeUndefined();
    expect(suggestCompensations(result.current.movimientos)).toHaveLength(1);
  });
});
