import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfilePanel } from './ProfilePanel';

const privacy = vi.hoisted(() => ({
  hasPin: true, isLocked: false, biometricAvailable: true, biometricEnabled: false,
  enableBiometric: vi.fn(), disableBiometric: vi.fn(), openUnlockModal: vi.fn(),
}));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => privacy }));
vi.mock('../../context/PreferencesContext', () => ({ usePreferences: () => ({
  horasSemanales: 40, umbralCompraPequena: 10, inicioPeriodo: 1, updatePreferences: vi.fn(),
}) }));
const show = () => render(<ProfilePanel isOpen user={null} onClose={vi.fn()} onLogout={vi.fn()} />);
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(privacy, { hasPin: true, isLocked: false, biometricAvailable: true, biometricEnabled: false });
  privacy.enableBiometric.mockResolvedValue(true);
});
afterEach(cleanup);

it.each([{ hasPin: false }, { biometricAvailable: false }])('hides the switch without PIN or support: %s', values => {
  Object.assign(privacy, values);
  show();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

it('activates while unlocked and deactivates without confirmation', async () => {
  const view = show();
  const toggle = screen.getByRole('switch');
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(toggle.querySelector('svg')).toHaveClass('lucide-fingerprint-pattern');
  expect(toggle.querySelector('.lucide-toggle-left')).not.toBeNull();
  await act(async () => fireEvent.click(toggle));
  expect(privacy.enableBiometric).toHaveBeenCalledTimes(1);
  privacy.biometricEnabled = true;
  view.rerender(<ProfilePanel isOpen user={null} onClose={vi.fn()} onLogout={vi.fn()} />);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(toggle).toHaveTextContent('Activado en este dispositivo');
  fireEvent.click(toggle);
  expect(privacy.disableBiometric).toHaveBeenCalledTimes(1);
  expect(privacy.openUnlockModal).not.toHaveBeenCalled();
});

it('unlocks first and only activates after a successful unlock', async () => {
  privacy.isLocked = true;
  show();
  fireEvent.click(screen.getByRole('switch'));
  expect(privacy.enableBiometric).not.toHaveBeenCalled();
  const callback = privacy.openUnlockModal.mock.calls[0][0];
  await act(async () => callback(false));
  expect(privacy.enableBiometric).not.toHaveBeenCalled();
  await act(async () => callback(true));
  expect(privacy.enableBiometric).toHaveBeenCalledTimes(1);
});

it('shows the activation error and clears it on the next attempt', async () => {
  privacy.enableBiometric.mockResolvedValueOnce(false);
  show();
  await act(async () => fireEvent.click(screen.getByRole('switch')));
  expect(screen.getByRole('alert')).toHaveTextContent('No se ha podido activar. Inténtalo de nuevo.');
  await act(async () => fireEvent.click(screen.getByRole('switch')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('hides the preferences while locked and offers to unlock', () => {
  privacy.isLocked = true;
  show();
  expect(screen.queryByLabelText('Horas de trabajo a la semana')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Inicio de tu periodo')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
  expect(privacy.openUnlockModal).toHaveBeenCalledTimes(1);
});

it('shows the preferences once unlocked', () => {
  show();
  expect(screen.getByLabelText('Horas de trabajo a la semana')).toHaveValue(40);
});
