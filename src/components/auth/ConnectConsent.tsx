import { useEffect, useMemo, useState } from 'react';
import { FlowtLogo } from '../common/FlowtLogo';
import {
  ConnectionError, WRITE_SCOPE, connectionsApiUrl, decideConnection, previewConnection, safeReturnAddress,
  type ConnectionRequest,
} from '../../utils/connectionsApi';

/** Where an assistant sends the user to approve its access (the OAuth authorization endpoint). */
export const CONNECT_PATH = '/conectar';

type View =
  | { step: 'loading' }
  | { step: 'ready'; request: ConnectionRequest }
  | { step: 'error'; message: string; redirectTo?: string };

const leave = (url: string) => window.location.assign(url);

export function ConnectConsent({ email, onLogout, navigate = leave }: { email?: string | null; onLogout?: () => void; navigate?: (url: string) => void }) {
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(window.location.search)), []);
  const available = !!connectionsApiUrl();
  const [view, setView] = useState<View>({ step: 'loading' });
  const [write, setWrite] = useState(true);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    if (!available) return;
    let active = true;
    previewConnection(params)
      .then(request => { if (active) setView({ step: 'ready', request }); })
      .catch(cause => {
        if (active) setView({ step: 'error', message: cause instanceof Error ? cause.message : 'No se pudo cargar la solicitud.', redirectTo: cause instanceof ConnectionError ? cause.redirectTo : undefined });
      });
    return () => { active = false; };
  }, [available, params]);

  async function answer(approve: boolean) {
    if (pending) return;
    setPending(true);
    setFailure('');
    try {
      const target = await decideConnection(params, approve, write);
      if (!safeReturnAddress(target)) throw new ConnectionError('La aplicación indicó una dirección de retorno no válida.');
      navigate(target);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'No se pudo completar la conexión.');
      setPending(false);
    }
  }

  const request = view.step === 'ready' ? view.request : null;
  const asksWrite = !!request?.scopes.includes(WRITE_SCOPE);
  return (
    <main className="app-canvas flex min-h-dvh items-center justify-center p-5 font-sans">
      <section className="flowt-card w-full max-w-md p-7 sm:p-10">
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <FlowtLogo size={34} />
          <span className="font-display text-2xl font-bold tracking-tight text-ink">Flowt</span>
        </div>
        {!available ? (
          <p role="alert" className="text-center text-sm text-ink-soft">Las conexiones con otras aplicaciones todavía no están disponibles en este entorno.</p>
        ) : view.step === 'loading' ? (
          <p role="status" className="text-center text-sm text-ink-soft">Comprobando la solicitud…</p>
        ) : view.step === 'error' ? (
          <>
            <h1 className="mb-3 text-center text-2xl font-bold text-ink">No se puede conectar</h1>
            <p role="alert" className="mb-6 text-center text-sm text-ink-soft">{view.message}</p>
            {view.redirectTo && safeReturnAddress(view.redirectTo) && (
              <button type="button" onClick={() => navigate(view.redirectTo!)} className="dashboard-secondary-button w-full !py-3 !text-sm">
                Volver a la aplicación
              </button>
            )}
          </>
        ) : request && (
          <>
            <h1 className="mb-3 text-center text-2xl font-bold text-ink">
              <span className="break-words">{request.client_name}</span> quiere conectarse a tu Flowt
            </h1>
            <p className="mb-6 text-center text-sm text-ink-soft">
              {email ? <>Has iniciado sesión como <span className="font-semibold text-ink">{email}</span>. </> : null}
              Al terminar volverás a {request.local ? 'una aplicación de este dispositivo' : <span className="font-semibold text-ink">{request.redirect_host}</span>}.
            </p>
            <ul className="mb-6 space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink">
              <li>
                <p className="font-semibold">Ver tus datos</p>
                <p className="text-ink-soft">Movimientos, carteras, suscripciones y correos del banco.</p>
              </li>
              {asksWrite && (
                <li>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={write} disabled={pending} onChange={event => setWrite(event.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
                    <span>
                      <span className="block font-semibold">Hacer cambios</span>
                      <span className="block text-ink-soft">Crear, editar y borrar movimientos, carteras y suscripciones.</span>
                    </span>
                  </label>
                </li>
              )}
            </ul>
            <p className="mb-6 text-xs text-ink-soft">
              Autoriza solo si has empezado tú esta conexión. Podrás retirarla cuando quieras en Ajustes → Conexiones.
            </p>
            {failure && <p role="alert" className="mb-4 text-sm text-rose-500">{failure}</p>}
            <button type="button" onClick={() => void answer(true)} disabled={pending} className="dashboard-primary-button mb-3 w-full !py-4 !text-sm disabled:opacity-50">
              {pending ? 'Conectando…' : 'Autorizar'}
            </button>
            <button type="button" onClick={() => void answer(false)} disabled={pending} className="dashboard-secondary-button w-full !py-3 !text-sm disabled:opacity-50">
              Cancelar
            </button>
          </>
        )}
        {onLogout && view.step !== 'loading' && (
          <button type="button" onClick={onLogout} disabled={pending} className="mt-6 block w-full text-center text-xs font-semibold text-ink-soft underline-offset-2 hover:underline">
            Usar otra cuenta
          </button>
        )}
      </section>
    </main>
  );
}
