import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BancosView } from './BancosView';
import { BanksContext, type Bank } from '../../context/bankContext';
import { BanksProvider } from '../../context/BanksContext';
import type { Movimiento } from '../../types';

const privacy = vi.hoisted(() => ({ locked: false, unlock: vi.fn() }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: privacy.locked, openUnlockModal: privacy.unlock, formatCurrency: (value: number) => `${value.toFixed(2)} €` }) }));
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
    expect(screen.getByText('Unicaja')).toBeInTheDocument();
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
  it('bloqueada, solo ofrece desbloquear', () => {
    privacy.locked = true;
    try {
      setup([{ id: 'unicaja', nombre: 'Unicaja' }], ['Unicaja']);
      expect(screen.getByText('Desbloquea Flowt para ver y configurar tus bancos.')).toBeInTheDocument();
      expect(screen.queryByText('Añadir banco')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
      expect(privacy.unlock).toHaveBeenCalled();
    } finally { privacy.locked = false; }
  });
});

describe('bulk bank assignment', () => {
  const one = [{ id: 'bbva', nombre: 'BBVA' }];
  const many = [...one, { id: 'n26', nombre: 'N26' }];
  const assignmentView = (banks: Bank[], count: number, assign = vi.fn().mockResolvedValue(undefined)) => render(
    <BanksContext.Provider value={{ banks, addBank, removeBank, anchorBank: vi.fn() }}>
      <BancosView chartMovements={[]} countMovimientosWithoutBank={vi.fn().mockResolvedValue(count)} assignMovimientosWithoutBank={assign} />
    </BanksContext.Provider>,
  );
  it('uses singular, no selector for one bank and hides the block after success', async () => {
    const assign = vi.fn().mockResolvedValue(undefined);
    assignmentView(one, 1, assign);
    expect(await screen.findByText('1 movimiento sin banco.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Banco' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Asignar a BBVA' }));
    await waitFor(() => expect(screen.queryByText('1 movimiento sin banco.')).not.toBeInTheDocument());
    expect(assign).toHaveBeenCalledWith('BBVA');
  });
  it('uses plural, selects the destination and disables the button while assigning', async () => {
    let complete!: () => void;
    const assign = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    assignmentView(many, 2, assign);
    expect(await screen.findByText('2 movimientos sin banco.')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Banco' });
    expect(select).toHaveValue('BBVA');
    expect(select.querySelectorAll('option')).toHaveLength(2);
    fireEvent.change(select, { target: { value: 'N26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Asignar a N26' }));
    expect(screen.getByRole('button', { name: 'Asignando…' })).toBeDisabled();
    expect(assign).toHaveBeenCalledWith('N26');
    await act(async () => complete());
    expect(screen.queryByText('2 movimientos sin banco.')).not.toBeInTheDocument();
  });
  it('shows the specified error and allows retry', async () => {
    const assign = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue(undefined);
    assignmentView(one, 3, assign);
    fireEvent.click(await screen.findByRole('button', { name: 'Asignar a BBVA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se han podido asignar. Inténtalo de nuevo.');
    fireEvent.click(screen.getByRole('button', { name: 'Asignar a BBVA' }));
    await waitFor(() => expect(screen.queryByText('3 movimientos sin banco.')).not.toBeInTheDocument());
  });
  it.each([{ banks: [], count: 2, locked: false }, { banks: one, count: 0, locked: false }, { banks: one, count: 2, locked: true }])('hides the block when unavailable: %j', async ({ banks, count, locked }) => {
    privacy.locked = locked;
    try {
      await act(async () => { assignmentView(banks, count); });
      expect(screen.queryByRole('button', { name: /Asignar a/ })).not.toBeInTheDocument();
    } finally { privacy.locked = false; }
  });
});
