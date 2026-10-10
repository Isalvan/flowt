import { auth } from '../firebase';

/** What an app asking to connect will get, as validated by the server. */
export interface ConnectionRequest { client_name: string; scopes: string[]; redirect_host: string; local: boolean }
export interface Connection { id: string; client_name: string; scopes: string[]; redirect_host?: string | null; created_at?: string; last_used_at?: string }

export const WRITE_SCOPE = 'flowt:write';
export const connectionsApiUrl = () => String(import.meta.env.VITE_REVIEW_API_URL ?? '').replace(/\/$/, '');

/** `redirectTo` is set when the app that asked should be told about the failure. */
export class ConnectionError extends Error {
  redirectTo?: string;
  constructor(message: string, redirectTo?: string) {
    super(message);
    this.redirectTo = redirectTo;
  }
}

async function post(path: string, body: unknown) {
  const user = auth.currentUser;
  if (!user) throw new ConnectionError('Inicia sesión para continuar.');
  const owner = user.uid;
  const token = await user.getIdToken();
  let response: Response;
  let payload;
  try {
    response = await fetch(`${connectionsApiUrl()}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    payload = await response.json();
  } catch {
    throw new ConnectionError('No se pudo contactar con Flowt. Inténtalo de nuevo.');
  }
  if (auth.currentUser?.uid !== owner) throw new ConnectionError('La sesión ha cambiado. Vuelve a empezar.');
  if (!response.ok) {
    const description = typeof payload?.error_description === 'string' ? payload.error_description : 'No se pudo completar la operación.';
    throw new ConnectionError(description, typeof payload?.redirect_to === 'string' ? payload.redirect_to : undefined);
  }
  return payload;
}

export const previewConnection = (params: Record<string, string>): Promise<ConnectionRequest> =>
  post('/oauth/authorize/preview', { params });

/** Records the user's answer and returns the address that takes them back to the app. */
export const decideConnection = async (params: Record<string, string>, approve: boolean, write: boolean): Promise<string> =>
  (await post('/oauth/authorize/decision', { params, approve, write })).redirect_to;

export const listConnections = (): Promise<{ items: Connection[]; mcp_url: string }> => post('/api/connections/list', {});

export const revokeConnection = async (id: string): Promise<boolean> =>
  (await post('/api/connections/revoke', { connection_id: id })).revoked === true;

/** Only web and app addresses: never a script or local-file URL handed back by a server. */
export function safeReturnAddress(url: string): boolean {
  try {
    return !['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
