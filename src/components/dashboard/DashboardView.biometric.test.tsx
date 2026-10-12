import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardView } from './DashboardView';

const privacy = vi.hoisted(() => ({
  isLocked: true, biometricEnabled: false, openUnlockModal: vi.fn(), formatCurrency: String,
}));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => privacy }));
vi.mock('../../context/PreferencesContext', () => ({ usePreferences: () => ({ inicioPeriodo: 1 }) }));
const props: ComponentProps<typeof DashboardView> = {
  hasPin: true, onUnlock: vi.fn(), movimientos: [], chartMovements: [], huchas: [], suscripciones: [],
  balance: 0, huchaMonthlyBudgets: {}, chartData: [], onUpdateConcepto: vi.fn(), onConvert: vi.fn(),
  onLink: vi.fn(), onUnlink: vi.fn(), onChangeHucha: vi.fn(), onDeleteMovimiento: vi.fn(),
  onOpenHuchaModal: vi.fn(), onDeleteHucha: vi.fn(), onOpenTransferModal: vi.fn(),
  onOpenHistoryModal: vi.fn(), onOpenManualMovimientoModal: vi.fn(),
};
beforeEach(() => { vi.clearAllMocks(); privacy.biometricEnabled = false; });
afterEach(cleanup);

it('preserves the PIN screen without biometric enrollment', () => {
  render(<DashboardView {...props} />);
  expect(screen.getByText('Introduce tu PIN para ver tus saldos, carteras y movimientos.')).toBeInTheDocument();
  expect(screen.queryByText('Usar el PIN')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Desbloquear' }).querySelector('.lucide-lock')).not.toBeNull();
});

it('shows the biometric text, fingerprint button and direct PIN alternative', () => {
  privacy.biometricEnabled = true;
  render(<DashboardView {...props} />);
  expect(screen.getByText('Usa el desbloqueo de este dispositivo o tu PIN para ver tus saldos, carteras y movimientos.')).toBeInTheDocument();
  const unlock = screen.getByRole('button', { name: 'Desbloquear' });
  expect(unlock.querySelector('svg')).toHaveClass('lucide-fingerprint-pattern');
  fireEvent.click(unlock);
  expect(props.onUnlock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Usar el PIN' }));
  expect(privacy.openUnlockModal).toHaveBeenCalledWith(undefined, { pinOnly: true });
});

it('keeps the creation screen unchanged without a PIN', () => {
  privacy.biometricEnabled = true;
  render(<DashboardView {...props} hasPin={false} />);
  expect(screen.queryByText('Usar el PIN')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Crear PIN' }).querySelector('.lucide-lock')).not.toBeNull();
});
