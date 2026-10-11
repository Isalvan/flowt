import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bank } from '../../context/bankContext';
import { BanksCard } from './BanksCard';
const mocks = vi.hoisted(() => ({ banks: [] as Bank[], locked: false, anchorBank: vi.fn() }));
vi.mock('../../hooks/useBanks', () => ({ useBanks: () => mocks }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: mocks.locked, formatCurrency: (n: number) => `${n.toFixed(2)} €` }) }));
const bank: Bank = { id: 'bbva', nombre: 'BBVA' };
const setup = (walletsTotal = 50) => render(<BanksCard movimientos={[]} walletsTotal={walletsTotal} />);
beforeEach(() => { mocks.banks = []; mocks.locked = false; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T12:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('BanksCard', () => {
  it('does not render without banks or while locked', () => {
    const view = setup(); expect(view.container).toBeEmptyDOMElement();
    mocks.banks = [bank]; mocks.locked = true; view.rerender(<BanksCard movimientos={[]} walletsTotal={0} />);
    expect(view.container).toBeEmptyDOMElement();
  });
  it('shows an unanchored row and opens the modal', () => {
    mocks.banks = [bank]; setup();
    expect(screen.getByText('Sin saldo anotado')).toBeInTheDocument();
    expect(screen.queryByText('Total en bancos')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anotar saldo de BBVA' }));
    expect(screen.getByRole('heading', { name: 'Anotar saldo de BBVA' })).toBeInTheDocument();
  });
  it('shows anchored amounts, total and positive comparison', () => {
    mocks.banks = [{ ...bank, anclaSaldo: 100, anclaFecha: new Date() }]; setup();
    expect(screen.getByRole('button', { name: 'Actualizar saldo de BBVA' })).toHaveTextContent('100.00 €');
    expect(screen.getByText('Anotado hoy')).toBeInTheDocument();
    expect(screen.getByText('Total en bancos')).toBeInTheDocument();
    expect(screen.getByText('Tus carteras suman 50.00 €: 50.00 € sin repartir.')).toBeInTheDocument();
  });
  it('warns for anchors older than 30 days and compares negative difference', () => {
    mocks.banks = [{ ...bank, anclaSaldo: 20, anclaFecha: new Date('2026-09-10T12:00:00Z') }]; setup();
    expect(screen.getByText('Anotado hace 31 días · conviene actualizarlo')).toHaveClass('text-sun-600');
    expect(screen.getByText('Tus carteras suman 50.00 €: 30.00 € más de lo que hay en tus bancos.')).toBeInTheDocument();
  });
  it('shows missing bank counts with singular and plural and hides matching comparison', () => {
    mocks.banks = [{ ...bank, anclaSaldo: 50, anclaFecha: new Date() }, { id: 'n', nombre: 'N26' }];
    const view = setup(); expect(screen.getByText('Falta anotar 1 banco para comparar con tus carteras.')).toBeInTheDocument();
    mocks.banks.push({ id: 'r', nombre: 'Revolut' }); view.rerender(<BanksCard movimientos={[]} walletsTotal={50} />);
    expect(screen.getByText('Falta anotar 2 bancos para comparar con tus carteras.')).toBeInTheDocument();
    mocks.banks = mocks.banks.slice(0, 1); view.rerender(<BanksCard movimientos={[]} walletsTotal={50} />);
    expect(screen.queryByText(/Tus carteras suman/)).not.toBeInTheDocument();
  });
});
