import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase';
import { FlowtLogo } from '../common/FlowtLogo';

export const MANUAL_LOGIN_PATH = '/acceso/chati-35004424751f4017';
const MANUAL_ACCOUNT_EMAIL = 'chati@flowt-63536.firebaseapp.com';

export function ManualLogin({ configured }: { configured: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !configured) return;
    setError('');
    if (username.trim().toLowerCase() !== 'chati') {
      setError('Usuario o contraseña incorrectos.');
      return;
    }
    setPending(true);
    try {
      await signInWithEmailAndPassword(auth, MANUAL_ACCOUNT_EMAIL, password);
      setPassword('');
      window.history.replaceState(null, '', '/');
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === 'auth/too-many-requests'
        ? 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.'
        : code === 'auth/network-request-failed'
          ? 'No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.'
          : 'Usuario o contraseña incorrectos.');
    } finally {
      setPending(false);
    }
  }

  const field = 'mb-5 w-full rounded-xl border border-line-strong bg-surface-2 p-3 text-ink focus:outline-none focus-visible:border-brand';
  return (
    <main className="app-canvas flex min-h-dvh items-center justify-center p-5 font-sans">
      <form onSubmit={submit} className="flowt-card w-full max-w-md p-7 sm:p-10">
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <FlowtLogo size={34} />
          <span className="font-display text-2xl font-bold tracking-tight text-ink">Flowt</span>
        </div>
        <h1 className="mb-8 text-center text-2xl font-bold text-ink">Acceso manual</h1>
        <label htmlFor="manual-user" className="mb-2 block text-sm font-semibold text-ink-soft">Usuario</label>
        <input id="manual-user" name="username" autoComplete="username" required disabled={pending}
          value={username} onChange={event => setUsername(event.target.value)}
          className={field} />
        <label htmlFor="manual-password" className="mb-2 block text-sm font-semibold text-ink-soft">Contraseña</label>
        <input id="manual-password" name="password" type="password" autoComplete="current-password" required disabled={pending}
          value={password} onChange={event => setPassword(event.target.value)}
          className={field} />
        {!configured && <p role="alert" className="mb-4 text-sm text-rose-500">El acceso no está configurado en este entorno.</p>}
        {error && <p role="alert" className="mb-4 text-sm text-rose-500">{error}</p>}
        <button type="submit" disabled={pending || !configured}
          className="dashboard-primary-button w-full !py-4 !text-sm disabled:opacity-50">
          {pending ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </button>
      </form>
    </main>
  );
}
