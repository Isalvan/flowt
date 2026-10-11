import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { ActivityList } from './ActivityList';
import { BanksContext } from '../../context/bankContext';

const privacy = vi.hoisted(() => ({ locked: false }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: privacy.locked, formatCurrency: (n: number) => `${n} €` }) }));
const setup = (onDismissDuplicate?: (a: string, b: string) => Promise<void>, dates = ['2026-10-11T12:00:00+02:00', '2026-10-11T12:05:00+02:00']) => {
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-11T20:00:00Z').getTime());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T20:00:00Z'));
  const movements: Movimiento[] = dates.map((date, i) => ({ id: i ? 'b' : 'a', tipo: 'gasto', concepto: 'Café', importe: 12.50, categoria: 'restaurantes', fecha_operacion: date }));
  render(<ActivityList movimientos={movements} allMovimientos={movements} huchas={[]} huchaMonthlyBudgets={{}} onDismissDuplicate={onDismissDuplicate} onUpdateConcepto={vi.fn()} onConvert={vi.fn()} onLink={vi.fn()} onUnlink={vi.fn()} onChangeHucha={vi.fn()} onDeleteMovimiento={vi.fn()} />);
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); privacy.locked = false; });

describe('aviso de duplicados en la lista', () => {
  it('shows configured and detected banks without case-insensitive repeats', () => {
    const movements: Movimiento[] = [{ id: 'one', tipo: 'gasto', concepto: 'Compra', importe: 10, fecha_operacion: '2026-10-11', banco: 'Trade Republic' }, { id: 'two', tipo: 'gasto', concepto: 'Compra', importe: 20, fecha_operacion: '2026-10-11', banco: 'unicaja' }];
    render(<BanksContext.Provider value={{ banks: [{ id: 'unicaja', nombre: 'Unicaja' }, { id: 'bbva', nombre: 'BBVA' }], addBank: vi.fn(), removeBank: vi.fn() }}><ActivityList movimientos={movements} allMovimientos={movements} huchas={[]} huchaMonthlyBudgets={{}} onUpdateConcepto={vi.fn()} onConvert={vi.fn()} onLink={vi.fn()} onUnlink={vi.fn()} onChangeHucha={vi.fn()} onDeleteMovimiento={vi.fn()} /></BanksContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
    expect(within(screen.getByRole('combobox', { name: 'Banco' })).getAllByRole('option').map(o => o.textContent)).toEqual(['Todos los bancos', 'BBVA', 'Trade Republic', 'Unicaja']);
  });
  it('marca ambas filas, cuenta una revisión y descarta con ambos ids desde la más reciente', async () => {
    const dismiss = vi.fn().mockResolvedValue(undefined);
    setup(dismiss);
    expect(screen.getAllByText('Posible duplicado')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Revisar 1/ })).toBeInTheDocument();
    const review = screen.getByLabelText('Revisar duplicado de Café');
    expect(review).toHaveTextContent('Mismo importe y comercio que otro cargo hecho 5 min antes');
    fireEvent.click(within(review).getByRole('button', { name: 'Es correcto' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith('a', 'b'));
  });
  it('omite el aviso sin manejador o con la privacidad bloqueada', () => {
    setup();
    expect(screen.queryByText('Posible duplicado')).not.toBeInTheDocument();
    expect(screen.queryByText('Es correcto')).not.toBeInTheDocument();
  });
  it('oculta el aviso cuando los datos están bloqueados', () => {
    privacy.locked = true;
    setup(vi.fn());
    expect(screen.queryByText('Posible duplicado')).not.toBeInTheDocument();
    expect(screen.queryByText('Es correcto')).not.toBeInTheDocument();
  });
  it('explica las fechas sin hora y permite reintentar errores', async () => {
    setup(vi.fn().mockRejectedValue(new Error('No se ha podido guardar')), ['2026-10-11', '2026-10-11T19:00:00+02:00']);
    expect(screen.getByText('Mismo importe y comercio que otro cargo del mismo día')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Es correcto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido guardar');
    expect(screen.getByRole('button', { name: 'Es correcto' })).not.toBeDisabled();
  });
});
