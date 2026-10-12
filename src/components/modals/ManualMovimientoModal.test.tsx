import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BanksContext, type Bank } from '../../context/bankContext';
import { ManualMovimientoModal } from './ManualMovimientoModal';
import type { Hucha } from '../../types';

const wallet: Hucha = { id: 'wallet', nombre: 'Cuenta', saldo_acumulado: 100, objetivo: null, tipo_aportacion: 'resto', orden: 1, es_principal: true };
const banks = [{ id: 'bbva', nombre: 'BBVA' }, { id: 'n26', nombre: 'N26' }];
const onSave = vi.fn();
const setup = (configured: Bank[]) => render(<BanksContext.Provider value={{ banks: configured, addBank: vi.fn(), removeBank: vi.fn(), anchorBank: vi.fn() }}>
  <ManualMovimientoModal isOpen onClose={vi.fn()} onSave={onSave} huchas={[wallet]} />
</BanksContext.Provider>);
const submit = () => {
  fireEvent.change(screen.getByLabelText('Concepto'), { target: { value: 'Compra' } });
  fireEvent.change(screen.getByLabelText('Importe (€)'), { target: { value: '12.126' } });
  fireEvent.submit(screen.getByLabelText('Concepto').closest('form')!);
};
beforeEach(() => { onSave.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

describe('manual bank selection', () => {
  it.each([0, 1])('saves with %s banks without displaying a bank field', async count => {
    setup(banks.slice(0, count));
    fireEvent.click(screen.getByRole('button', { name: /^Banco/ }));
    expect(screen.queryByLabelText('Banco')).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].importe).toBe(12.13);
    if (count) expect(onSave.mock.calls[0][0].banco).toBe('BBVA');
    else expect(onSave.mock.calls[0][0]).not.toHaveProperty('banco');
  });
  it('preselects the first bank and saves the chosen bank with multiple banks', async () => {
    setup(banks);
    fireEvent.click(screen.getByRole('button', { name: /^Banco/ }));
    const select = screen.getByLabelText('Banco');
    expect(select).toHaveValue('BBVA');
    fireEvent.change(select, { target: { value: 'N26' } });
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ banco: 'N26', es_metalico: false })));
  });
  it('omits bank on cash payments after selecting a bank', async () => {
    setup(banks);
    fireEvent.click(screen.getByRole('button', { name: /^Banco/ }));
    fireEvent.change(screen.getByLabelText('Banco'), { target: { value: 'N26' } });
    fireEvent.click(screen.getByRole('button', { name: /^Efectivo/ }));
    expect(screen.queryByLabelText('Banco')).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('banco');
    expect(onSave.mock.calls[0][0].es_metalico).toBe(true);
  });
});
