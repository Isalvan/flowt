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
  return <section className="w-full max-w-4xl mx-auto dashboard-surface p-5 sm:p-6">
    <h3 className="dashboard-heading">Conexiones</h3>
    {isLocked ? <div className="py-6 text-center"><p className="text-sm text-ink-soft mb-3">Desbloquea Flowt para ver tus conexiones.</p><button onClick={() => openUnlockModal()} className="dashboard-primary-button">Desbloquear</button></div>
      : demo ? <p className="mt-4 text-sm text-ink-soft">Podrás conectar asistentes como Claude o ChatGPT desde tu cuenta. La demo no admite conexiones.</p>
      : !connectionsApiUrl() ? <p className="mt-4 text-sm text-ink-soft">Las conexiones con otras aplicaciones todavía no están disponibles.</p>
      : !userId ? <p className="mt-4 text-sm text-ink-soft">Inicia sesión para ver tus conexiones.</p>
      : <>
        <p className="dashboard-subtitle mt-2 mb-5">Un asistente como Claude o ChatGPT puede consultar y gestionar tus finanzas por ti. Añade esta dirección como conector en el asistente: te traerá aquí para que le des permiso, sin copiar ninguna clave.</p>
        {visible && state.address && <div className="mb-6 flex flex-col gap-2 rounded-xl bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="dashboard-label">Dirección del conector</p>
            <p className="mt-1 break-all font-mono text-sm text-ink">{state.address}</p>
          </div>
          <button onClick={() => void copy()} className="dashboard-secondary-button shrink-0">{state.copied ? 'Copiada' : 'Copiar'}</button>
        </div>}
        {visible && state.error && <p role="alert" className="notice is-danger mb-4">{state.error}</p>}
        {visible && state.items.map(connection => <article key={connection.id} className="mb-3 flex flex-col gap-3 rounded-xl bg-surface-2 p-4 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold break-words">{connection.client_name}{connection.redirect_host ? <span className="font-normal text-ink-soft"> · {connection.redirect_host}</span> : null}</p>
            <p className="mt-1 text-xs text-ink-soft">{connection.scopes.includes(WRITE_SCOPE) ? 'Puede ver y hacer cambios' : 'Solo puede ver'} · Conectada el {formatDate(connection.created_at)} · Último uso el {formatDate(connection.last_used_at)}</p>
          </div>
          <button onClick={() => void disconnect(connection)} disabled={!!state.busy} className="dashboard-danger-button shrink-0">{state.busy === connection.id ? 'Desconectando…' : 'Desconectar'}</button>
        </article>)}
        {(!visible || state.loading) && <p role="status" className="text-sm text-ink-soft">Cargando conexiones…</p>}
        {visible && !state.loading && !state.error && state.items.length === 0 && <p className="text-sm text-ink-soft">Todavía no has conectado ninguna aplicación.</p>}
        {visible && state.error && !state.loading && <button onClick={() => setAttempt(value => value + 1)} className="dashboard-secondary-button mt-3">Reintentar</button>}
      </>}
  </section>;
}
