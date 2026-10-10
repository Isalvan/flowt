import { useEffect, useState } from 'react';
import { usePrivacy } from '../../context/PrivacyContext';
import { WRITE_SCOPE, connectionsApiUrl, listConnections, revokeConnection, type Connection } from '../../utils/connectionsApi';

const formatDate = (value?: string) => !value || Number.isNaN(Date.parse(value))
  ? 'fecha no disponible'
  : new Date(value).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });

interface State { owner: string; items: Connection[]; address: string; loading: boolean; error: string; busy: string; copied: boolean }
const empty = (owner = ''): State => ({ owner, items: [], address: '', loading: true, error: '', busy: '', copied: false });

/** Assistants the user has let into Flowt, and the address to connect a new one. */
export function ConnectionsView({ userId, demo = false }: { userId?: string; demo?: boolean }) {
  const { isLocked, openUnlockModal } = usePrivacy();
  const enabled = !!userId && !isLocked && !demo && !!connectionsApiUrl();
  const [state, setState] = useState<State>(empty);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !userId) return;
    let active = true;
    queueMicrotask(() => { if (active) setState(previous => ({ ...(previous.owner === userId ? previous : empty(userId)), loading: true, error: '' })); });
    listConnections()
      .then(page => { if (active) setState(previous => ({ ...previous, owner: userId, items: page.items, address: page.mcp_url, loading: false })); })
      .catch(cause => { if (active) setState(previous => ({ ...previous, owner: userId, loading: false, error: cause instanceof Error ? cause.message : 'No se pudieron cargar tus conexiones.' })); });
    return () => { active = false; };
  }, [enabled, userId, attempt]);

  const disconnect = async (connection: Connection) => {
    setState(previous => ({ ...previous, busy: connection.id, error: '' }));
    try {
      await revokeConnection(connection.id);
      setState(previous => ({ ...previous, busy: '', items: previous.items.filter(item => item.id !== connection.id) }));
    } catch (cause) {
      setState(previous => ({ ...previous, busy: '', error: cause instanceof Error ? cause.message : 'No se pudo desconectar.' }));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.address);
      setState(previous => ({ ...previous, copied: true }));
    } catch {
      setState(previous => ({ ...previous, error: 'No se pudo copiar. Selecciona la dirección y cópiala a mano.' }));
    }
  };

  const visible = enabled && state.owner === userId;
  return <section className="w-full max-w-4xl mx-auto rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 p-5 sm:p-6">
    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Conexiones</h3>
    {isLocked ? <div className="py-6 text-center"><p className="text-sm text-slate-500 mb-3">Desbloquea Flowt para ver tus conexiones.</p><button onClick={() => openUnlockModal()} className="rounded-xl bg-indigo-600 text-white px-4 py-2 font-semibold">Desbloquear</button></div>
      : demo ? <p className="mt-4 text-sm text-slate-500">Podrás conectar asistentes como Claude o ChatGPT desde tu cuenta. La demo no admite conexiones.</p>
      : !connectionsApiUrl() ? <p className="mt-4 text-sm text-slate-500">Las conexiones con otras aplicaciones todavía no están disponibles.</p>
      : !userId ? <p className="mt-4 text-sm text-slate-500">Inicia sesión para ver tus conexiones.</p>
      : <>
        <p className="mt-2 mb-5 text-sm text-slate-500 dark:text-slate-400">Un asistente como Claude o ChatGPT puede consultar y gestionar tus finanzas por ti. Añade esta dirección como conector en el asistente: te traerá aquí para que le des permiso, sin copiar ninguna clave.</p>
        {visible && state.address && <div className="mb-6 flex flex-col gap-2 rounded-xl bg-white/50 dark:bg-slate-800/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Dirección del conector</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-800 dark:text-slate-100">{state.address}</p>
          </div>
          <button onClick={() => void copy()} className="shrink-0 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-3 py-2 text-sm font-semibold">{state.copied ? 'Copiada' : 'Copiar'}</button>
        </div>}
        {visible && state.error && <p role="alert" className="mb-4 text-sm text-red-600">{state.error}</p>}
        {visible && state.items.map(connection => <article key={connection.id} className="mb-3 flex flex-col gap-3 rounded-xl bg-white/50 dark:bg-slate-800/50 p-4 text-sm text-slate-800 dark:text-slate-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold break-words">{connection.client_name}{connection.redirect_host ? <span className="font-normal text-slate-500"> · {connection.redirect_host}</span> : null}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{connection.scopes.includes(WRITE_SCOPE) ? 'Puede ver y hacer cambios' : 'Solo puede ver'} · Conectada el {formatDate(connection.created_at)} · Último uso el {formatDate(connection.last_used_at)}</p>
          </div>
          <button onClick={() => void disconnect(connection)} disabled={!!state.busy} className="shrink-0 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3 py-2 font-semibold disabled:opacity-50">{state.busy === connection.id ? 'Desconectando…' : 'Desconectar'}</button>
        </article>)}
        {(!visible || state.loading) && <p role="status" className="text-sm text-slate-500">Cargando conexiones…</p>}
        {visible && !state.loading && !state.error && state.items.length === 0 && <p className="text-sm text-slate-500">Todavía no has conectado ninguna aplicación.</p>}
        {visible && state.error && !state.loading && <button onClick={() => setAttempt(value => value + 1)} className="mt-3 text-sm font-semibold text-indigo-600">Reintentar</button>}
      </>}
  </section>;
}
