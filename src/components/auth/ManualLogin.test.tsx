import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { ManualLogin, MANUAL_LOGIN_PATH } from './ManualLogin';

vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: vi.fn() }));

describe('Manual login', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState(null, '', MANUAL_LOGIN_PATH);
  });

  function submit(username = 'chati') {
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: username } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
  }

  it('authenticates with Firebase and removes the hidden path on success', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({} as never);
    render(<ManualLogin configured />);
    submit();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'chati@flowt-63536.firebaseapp.com', 'test-password');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
  });

  it('rejects other usernames without starting a Firebase session', () => {
    render(<ManualLogin configured />);
    submit('other');
    expect(screen.getByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('stays on the hidden path when Firebase rejects the password', async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue({ code: 'auth/invalid-credential' });
    render(<ManualLogin configured />);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(window.location.pathname).toBe(MANUAL_LOGIN_PATH);
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });

  it('disables login when Firebase is unavailable', () => {
    render(<ManualLogin configured={false} />);
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled();
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });
});
