import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hucha } from '../../types';
import { ReconcileModal } from './ReconcileModal';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false, formatCurrency: (n: number) => `${n.toFixed(2)} €` }) }));
const wallets: Hucha[] = [
  { id: 'first', nombre: 'Primera', saldo_acumulado: 10, objetivo: null, tipo_aportacion: 'flat', orden: 0 },
  { id: 'main', nombre: 'Principal', saldo_acumulado: 50, objetivo: null, tipo_aportacion: 'flat', orden: 1, es_principal: true },
  { id: 'rest', nombre: 'Resto', saldo_acumulado: 100, objetivo: null, tipo_aportacion: 'resto', orden: 2 },
  { id: 'cash', nombre: 'Efectivo', saldo_acumulado: 30, objetivo: null, tipo_aportacion: 'resto', orden: 3, es_metalico: true },
  { id: 'archived', nombre: 'Archivada', saldo_acumulado: 40, objetivo: null, tipo_aportacion: 'resto', orden: 4, activa: false },
];
const onSave = vi.fn();
const onClose = vi.fn();
const setup = (difference = 25.126, huchas = wallets) => render(<ReconcileModal huchas={huchas} difference={difference} onSave={onSave} onClose={onClose} />);
beforeEach(() => { onSave.mockReset().mockResolvedValue(undefined); onClose.mockReset(); });
afterEach(cleanup);

describe('ReconcileModal', () => {
  it.each([25.126, -125.126])('shows the direction and resulting cents and saves a signed amount: %s', async difference => {
    setup(difference);
    const amount = Math.round(difference * 100) / 100;
    expect(screen.getByRole('heading', { name: 'Cuadrar con tus bancos' })).toBeInTheDocument();
    expect(screen.getByText(difference > 0
      ? 'En tus bancos hay 25.13 € más de lo que suman tus carteras. Elige a qué cartera van.'
      : 'Tus carteras suman 125.13 € más de lo que hay en tus bancos. Elige de qué cartera se restan.')).toBeInTheDocument();
    expect(screen.getByLabelText('Cartera')).toHaveValue('rest');
    expect(screen.getByText(`${(100 + amount).toFixed(2)} €`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cuadrar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('rest', amount));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it.each([{ ids: ['first', 'main'], expected: 'main' }, { ids: ['first'], expected: 'first' }])('falls back to the principal then first wallet: %j', ({ ids, expected }) => {
    setup(20, wallets.filter(h => ids.includes(h.id)));
    expect(screen.getByLabelText('Cartera')).toHaveValue(expected);
  });
  it('excludes cash and inactive wallets and previews a new selection', () => {
    setup();
    const select = screen.getByLabelText('Cartera');
    expect(select.querySelectorAll('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Principal · 50.00 €' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'main' } });
    expect(screen.getByText('75.13 €')).toBeInTheDocument();
  });
  it('disables saving and cancellation while saving and reports failures', async () => {
    let reject!: (error: Error) => void;
    onSave.mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; }));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cuadrar' }));
    expect(screen.getByRole('button', { name: 'Cuadrar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await act(async () => reject(new Error()));
    expect(screen.getByRole('alert')).toHaveTextContent('No se ha podido cuadrar.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cuadrar' })).not.toBeDisabled();
  });
  it('cancels without saving and disables confirmation without an eligible wallet', () => {
    setup(20, []);
    expect(screen.getByRole('button', { name: 'Cuadrar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
