/** Drives the Worker over HTTP requests against the in-memory Firestore. */
import { createHash } from 'node:crypto';
import { FlowtError } from '../src/errors.js';
import { createWorker } from '../src/worker.js';
import { MemoryDb } from './memoryDb.js';

export const BASE = 'https://mcp.flowt.example';
export const APP = 'https://flowt.example';
export const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
export const VERIFIER = 'v'.repeat(64);
export const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
export const WEB = { Authorization: 'Bearer firebase-owner', Origin: APP };

/** A Firebase session is any token 'firebase-<uid>'; everything else is rejected. */
export async function verifyIdToken(token) {
  if (!token.startsWith('firebase-')) throw new FlowtError('unauthorized', 'Credenciales no válidas');
  return token.slice('firebase-'.length);
}

export function setup(envOverrides = {}) {
  const db = new MemoryDb();
  const clock = { now: new Date('2026-10-10T12:00:00Z') };
  const worker = createWorker({ db, verifyIdToken, now: () => clock.now });
  const env = { APP_URL: APP, FLOWT_REVIEW_WRITES_ENABLED: 'true', ...envOverrides };
  db.put('huchas', 'main', { id_propietario: 'owner', nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 100, orden: 1 });

  /** Send one request; `json` or `form` become the body with the matching content type. */
  async function send(path, { method = 'POST', headers = {}, json, form, body } = {}) {
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['Content-Type'] = 'application/json';
    } else if (form) {
      init.body = new URLSearchParams(form).toString();
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body !== undefined) init.body = body;
    const response = await worker.fetch(new Request(`${BASE}${path}`, init), env);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, headers: response.headers, data, text };
  }

  const register = (metadata = {}, headers = {}) => send('/oauth/register', { json: { client_name: 'Claude', redirect_uris: [CALLBACK], ...metadata }, headers });
  const requestParams = (clientId, overrides = {}) => ({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, state: 'xyz',
    code_challenge: CHALLENGE, code_challenge_method: 'S256', scope: 'flowt:read flowt:write', resource: `${BASE}/mcp`, ...overrides });

  async function authorize(clientId, { write = true, headers = WEB, overrides = {} } = {}) {
    const response = await send('/oauth/authorize/decision', { headers, json: { params: requestParams(clientId, overrides), approve: true, write } });
    if (response.status !== 200) throw new Error(`authorize failed: ${response.text}`);
    return new URL(response.data.redirect_to).searchParams.get('code');
  }

  const exchange = (clientId, code, overrides = {}) => send('/oauth/token', { form: { grant_type: 'authorization_code', client_id: clientId, code,
    code_verifier: VERIFIER, redirect_uri: CALLBACK, ...overrides } });

  async function connect({ write = true, metadata = {}, headers = WEB } = {}) {
    const clientId = (await register(metadata)).data.client_id;
    const tokens = (await exchange(clientId, await authorize(clientId, { write, headers }))).data;
    return { clientId, tokens };
  }

  const rpc = (token, method = 'tools/list', params = {}, extra = {}) => send('/mcp', {
    json: { jsonrpc: '2.0', id: 7, method, params },
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'MCP-Protocol-Version': '2025-11-25', ...extra } });

  const tool = async (token, name, args = {}, extra = {}) => (await rpc(token, 'tools/call', { name, arguments: args }, extra)).data.result;
  const toolNames = async (token) => (await rpc(token)).data.result.tools.map((t) => t.name);

  return { db, clock, env, worker, send, register, requestParams, authorize, exchange, connect, rpc, tool, toolNames };
}
