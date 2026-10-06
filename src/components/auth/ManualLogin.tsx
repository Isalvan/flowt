import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase';

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

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-950 font-sans">
      <form onSubmit={submit} className="w-full max-w-md bg-white/5 border border-white/10 rounded-[32px] p-8 sm:p-10 shadow-2xl">
        <img src="/flowt-logo.png" alt="Flowt" width={64} height={64} className="mx-auto mb-6" />
        <h1 className="text-2xl font-black text-white text-center mb-8">Acceso manual</h1>
        <label htmlFor="manual-user" className="block text-sm text-slate-300 mb-2">Usuario</label>
        <input id="manual-user" name="username" autoComplete="username" required disabled={pending}
          value={username} onChange={event => setUsername(event.target.value)}
          className="w-full rounded-xl bg-slate-900 border border-white/10 p-3 text-white mb-5" />
        <label htmlFor="manual-password" className="block text-sm text-slate-300 mb-2">Contraseña</label>
        <input id="manual-password" name="password" type="password" autoComplete="current-password" required disabled={pending}
          value={password} onChange={event => setPassword(event.target.value)}
          className="w-full rounded-xl bg-slate-900 border border-white/10 p-3 text-white mb-5" />
        {!configured && <p role="alert" className="text-sm text-rose-400 mb-4">El acceso no está configurado en este entorno.</p>}
        {error && <p role="alert" className="text-sm text-rose-400 mb-4">{error}</p>}
        <button type="submit" disabled={pending || !configured}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-sky-500 to-violet-600 text-white font-bold disabled:opacity-50 cursor-pointer">
          {pending ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </button>
      </form>
    </main>
  );
}
