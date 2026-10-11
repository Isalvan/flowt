import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorBalanceModal } from './AnchorBalanceModal';
import type { Bank } from '../../context/bankContext';
const mocks = vi.hoisted(() => ({ anchorBank: vi.fn(), locked: false }));
vi.mock('../../hooks/useBanks', () => ({ useBanks: () => mocks }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: mocks.locked, formatCurrency: (n: number) => `${n.toFixed(2)} €` }) }));
const bank: Bank = { id: 'bbva', nombre: 'BBVA' };
const anchored: Bank = { ...bank, anclaSaldo: 100, anclaFecha: new Date('2026-10-11T10:00:00Z') };
const onClose = vi.fn();
const setup = (selected = bank) => render(<AnchorBalanceModal bank={selected} movimientos={[]} onClose={onClose} />);
const input = (value: string) => fireEvent.change(screen.getByLabelText('Saldo que ves ahora'), { target: { value } });
beforeEach(() => { vi.clearAllMocks(); mocks.locked = false; mocks.anchorBank.mockResolvedValue(undefined); });
afterEach(cleanup);
describe('AnchorBalanceModal', () => {
  it('starts with an empty focused field and no comparison for the first anchor', async () => {
    setup();
    expect(screen.getByLabelText('Saldo que ves ahora')).toHaveFocus();
    expect(screen.queryByText('Flowt calculaba')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    input('125.75'); fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mocks.anchorBank).toHaveBeenCalledWith('bbva', 125.75, null));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('shows the estimate, signed difference and Coincide and saves the discrepancy', async () => {
    setup(anchored);
    expect(screen.getByText('Flowt calculaba')).toBeInTheDocument();
    expect(screen.getByText('100.00 €')).toBeInTheDocument();
    expect(screen.queryByText('Diferencia')).not.toBeInTheDocument();
    input('105'); expect(screen.getByText('+5.00 €')).toBeInTheDocument();
    input('100'); expect(screen.getByText('Coincide')).toHaveClass('text-emerald-600');
    input('90'); expect(screen.getByText('−10.00 €')).toHaveClass('text-rose-500');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mocks.anchorBank).toHaveBeenCalledWith('bbva', 90, -10));
  });
  it('keeps the modal open on error and permits retry', async () => {
    mocks.anchorBank.mockRejectedValueOnce(new Error('Error al guardar'));
    setup(); input('0'); fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Error al guardar');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled();
  });
  it('rejects out of range values and hides while locked', () => {
    const view = setup(); input('100000001'); expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    mocks.locked = true; view.rerender(<AnchorBalanceModal bank={bank} movimientos={[]} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
