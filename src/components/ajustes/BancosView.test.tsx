import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BancosView } from './BancosView';
import { BanksContext, type Bank } from '../../context/bankContext';
import { BanksProvider } from '../../context/BanksContext';
import type { Movimiento } from '../../types';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false, formatCurrency: (value: number) => `${value.toFixed(2)} €` }) }));
const addBank = vi.fn();
const removeBank = vi.fn();
const movements = (names: string[]): Movimiento[] => names.map((banco, i) => ({ id: String(i), banco, tipo: 'gasto', concepto: 'Compra', importe: 10, fecha_operacion: '2026-10-11' }));
const setup = (banks: Bank[] = [], names: string[] = []) => render(<BanksContext.Provider value={{ banks, addBank, removeBank, anchorBank: vi.fn() }}><BancosView chartMovements={movements(names)} /></BanksContext.Provider>);
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); addBank.mockResolvedValue(undefined); removeBank.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('BancosView', () => {
  it('shows the estimated balance, anchor date and last discrepancy and opens the anchor modal', () => {
    setup([{ id: 'bbva', nombre: 'BBVA', anclaSaldo: 120, anclaFecha: new Date(), ultimoDesfase: -62.1 }]);
    expect(screen.getByText('120.00 €')).toBeInTheDocument();
    expect(screen.getByText('Anotado hoy')).toBeInTheDocument();
    expect(screen.getByText('Último desfase: −62.10 €')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(screen.getByRole('heading', { name: 'Anotar saldo de BBVA' })).toBeInTheDocument();
  });
  it('lists banks with case-insensitive counts, singular and empty states', () => {
    setup([{ id: 'unicaja', nombre: 'Unicaja' }, { id: 'bbva', nombre: 'BBVA' }, { id: 'n26', nombre: 'N26' }], ['UNICaja', 'Unicaja', 'bbva']);
    expect(screen.getByText('2 movimientos en el último año')).toBeInTheDocument();
    expect(screen.getByText('1 movimiento en el último año')).toBeInTheDocument();
    expect(screen.getByText('Sin movimientos todavía')).toBeInTheDocument();
    expect(screen.getByText('UN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Unicaja/ })).not.toBeInTheDocument();
  });
  it('offers detected custom names first, by frequency, then remaining catalog banks', async () => {
    setup([], ['Caja Rural', 'N26', 'Caja Rural']);
    expect(screen.getByText('Aún no has añadido ningún banco')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Caja Rural · detectado');
    expect(buttons[1]).toHaveTextContent('N26 · detectado');
    expect(buttons[2]).toHaveTextContent('Revolut');
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(addBank).toHaveBeenCalledWith('Caja Rural'));
  });
  it('adds from Otro on submit, validates accent-insensitive duplicates and cancels with Escape', async () => {
    render(<BanksProvider forceDemo><BancosView chartMovements={[]} /></BanksProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }));
    let input = screen.getByLabelText('Nombre del banco');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('maxlength', '40');
    fireEvent.change(input, { target: { value: 'Ábaco' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('Ábaco')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }));
    input = screen.getByLabelText('Nombre del banco');
    fireEvent.change(input, { target: { value: 'abaco' } });
    expect(screen.getByText('Ya tienes ese banco')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Añadir' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Nombre del banco')).not.toBeInTheDocument();
  });
  it('asks for confirmation before removal', async () => {
    setup([{ id: 'unicaja', nombre: 'Unicaja' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Unicaja' }));
    expect(removeBank).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quitar Unicaja' })).toBeInTheDocument();
    expect(screen.getByText('Sus movimientos no se borran; solo deja de aparecer en tus bancos.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(removeBank).toHaveBeenCalledWith('unicaja'));
  });
  it('shows save errors and permits retry', async () => {
    addBank.mockRejectedValueOnce(new Error('No se ha podido guardar'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Revolut' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido guardar');
    expect(screen.getByRole('button', { name: 'Revolut' })).not.toBeDisabled();
  });
});
