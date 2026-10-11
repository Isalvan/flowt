/**
 * Flowt MCP Cloudflare Worker: stateless JSON-response MCP endpoint, its OAuth
 * server and the web app's review API.
 *
 * Supports Streamable HTTP protocol versions 2025-03-26, 2025-06-18 and 2025-11-25.
 * MCP clients sign in with OAuth (see oauth.js): the user approves the connection
 * in Flowt and nobody copies a token by hand. Firebase ID tokens authenticate the
 * web app. A separately configured long-lived bearer token can still drive the
 * scheduled review, limited to the review tools.
 */
import { FlowtError, OAuthError } from './errors.js';
import { FinanceService } from './financeService.js';
import { Firestore } from './firestore.js';
import { GoogleAuthClient } from './googleAuth.js';
import { createIdTokenVerifier } from './idToken.js';
import { AuthorizationServer, SCOPE_READ, SCOPE_WRITE } from './oauth.js';
import { createRateLimiter } from './rateLimiter.js';
import { ReviewService } from './reviewService.js';
import { valid } from './schema.js';
import { ACCESS, INSTRUCTIONS, SCOPE_REVIEW, TOOLS } from './tools.js';
import { plain, sameSecret } from './util.js';

const PROTOCOLS = ['2025-03-26', '2025-06-18', '2025-11-25'];
const ALL_SCOPES = [SCOPE_READ, SCOPE_WRITE, SCOPE_REVIEW];
const MAX_BODY = 64 * 1024;
// OAuth endpoints any MCP client may call from anywhere; they carry no ambient credentials.
const PUBLIC_PATHS = ['/.well-known/', '/oauth/register', '/oauth/token', '/oauth/revoke'];
const REVIEW_ACTIONS = { history: 'get_review_history', revert: 'revert_review', questions: 'list_review_questions', answer: 'resolve_question' };
const ID = { type: 'string', minLength: 1, maxLength: 200 };
const EDIT_SCHEMA = { type: 'object', additionalProperties: false, required: ['movement_id'], minProperties: 2,
  properties: { movement_id: ID, name: { type: 'string', minLength: 1, maxLength: 200 }, category: ID, hucha_id: ID } };
export const RATE_LIMITS = { perIpPerMinute: 120, perUserToolCallsPerMinute: 60 };

// Per isolate: the signed Google token and Firebase's public keys are reused across requests.
const isolate = { account: null, google: null, project: null, verifyIdToken: null };

function resolve(env) {
  const account = typeof env.FIREBASE_SERVICE_ACCOUNT === 'string' ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : env.FIREBASE_SERVICE_ACCOUNT;
  if (!account?.client_email || !account?.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
  const projectId = env.FIREBASE_PROJECT_ID || account.project_id;
  if (isolate.account !== account.client_email) {
    isolate.account = account.client_email;
    isolate.google = new GoogleAuthClient(account);
  }
  if (isolate.project !== projectId) {
    isolate.project = projectId;
    isolate.verifyIdToken = createIdTokenVerifier({ projectId });
  }
  const google = isolate.google;
  return { db: new Firestore({ projectId, getAccessToken: () => google.getAccessToken() }), verifyIdToken: isolate.verifyIdToken };
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new FlowtError('payload_too_large', 'Petición demasiado grande');
  return text;
}

async function readJson(request) {
  try {
    return JSON.parse(await readBody(request));
  } catch (error) {
    if (error instanceof FlowtError) throw error;
    return null;
  }
}

/** Token and revocation requests arrive as a form; some clients send JSON instead. */
async function readForm(request) {
  const text = await readBody(request);
  if ((request.headers.get('Content-Type') || '').includes('application/json')) {
    try {
      const body = JSON.parse(text);
      return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/**
 * Builds the Worker. `deps` replaces the Firestore client, the Firebase session
 * check and the clock in tests.
 * @param {{ db?: object, verifyIdToken?: (token: string) => Promise<string>, now?: () => Date }} [deps]
 */
export function createWorker(deps = {}) {
  const now = deps.now || (() => new Date());
  const ipLimiter = createRateLimiter({ limit: RATE_LIMITS.perIpPerMinute, windowMs: 60_000, now: () => now().getTime() });
  const userLimiter = createRateLimiter({ limit: RATE_LIMITS.perUserToolCallsPerMinute, windowMs: 60_000, now: () => now().getTime() });

  async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const isPublic = PUBLIC_PATHS.some((prefix) => path.startsWith(prefix));
    const appUrl = (env.APP_URL || '').replace(/\/$/, '');
    const allowedOrigins = [appUrl, ...(env.ALLOWED_ORIGINS || '').split(',')].map((value) => value.trim()).filter(Boolean)
      .map((value) => { try { return new URL(value).origin; } catch { return null; } });
    const origin = request.headers.get('Origin');
    const cors = !origin ? {} : {
      'Access-Control-Allow-Origin': isPublic ? '*' : origin, Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    };
    if (origin && !isPublic && !allowedOrigins.includes(origin)) return json({ error: 'origin_forbidden' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (path === '/' || path === '/health') return json({ status: 'ok', server: 'flowt-mcp' }, 200, cors);

    const limited = ipLimiter.check(`ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
    if (!limited.allowed) return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': String(limited.retryAfterSec) });

    let db = deps.db;
    let verifyIdToken = deps.verifyIdToken;
    if (!db || !verifyIdToken) {
      try {
        const resolved = resolve(env);
        db ||= resolved.db;
        verifyIdToken ||= resolved.verifyIdToken;
      } catch {
        console.error(JSON.stringify({ event: 'configuration_error' }));
        return json({ error: 'server_error', error_description: 'El servicio no está configurado' }, 500, cors);
      }
    }
    const issuer = (env.PUBLIC_ORIGIN || url.origin).replace(/\/$/, '');
    // Without the web app's address there is no consent screen, hence no OAuth.
    const oauth = appUrl ? new AuthorizationServer(db, { issuer, consentUrl: `${appUrl}/conectar`, now }) : null;
    const reviews = new ReviewService(db, { writesEnabled: String(env.FLOWT_REVIEW_WRITES_ENABLED).toLowerCase() === 'true', now });
    const finance = new FinanceService(db, { reviews, now });
    const financeWrites = String(env.FLOWT_MCP_WRITES_ENABLED ?? 'true').toLowerCase() === 'true';

    const bearer = () => /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '')?.[1] || '';

    /** The web app's session: a Firebase ID token and nothing else. */
    async function webOwner() {
      const token = bearer();
      if (!token) throw new FlowtError('unauthorized', 'Se requiere autenticación');
      return verifyIdToken(token);
    }

    /** Who is calling and what they may do: { uid, scopes }. */
    async function principal() {
      const token = bearer();
      if (!token) throw new FlowtError('unauthorized', 'Se requiere autenticación');
      const pilot = env.FLOWT_MCP_TOKEN || '';
      if (pilot.length >= 32 && env.FLOWT_MCP_OWNER_UID && sameSecret(token, pilot)) return { uid: env.FLOWT_MCP_OWNER_UID, scopes: [SCOPE_REVIEW] };
      if (token.startsWith('flowt_')) {
        const granted = oauth ? await oauth.authenticate(token) : null;
        if (!granted) throw new FlowtError('unauthorized', 'Credenciales no válidas');
        return granted;
      }
      return { uid: await verifyIdToken(token), scopes: ALL_SCOPES };
    }

    const visible = (who, definition) => {
      const access = ACCESS[definition.name];
      return access.scopes.some((scope) => who.scopes.includes(scope)) && !(access.service === 'finance' && access.write && !financeWrites);
    };

    async function dispatch(who, name, args) {
      const definition = TOOLS.find((candidate) => candidate.name === name);
      if (!definition) throw new FlowtError('unknown_tool', 'Herramienta desconocida');
      const access = ACCESS[name];
      if (!access.scopes.some((scope) => who.scopes.includes(scope))) throw new FlowtError('insufficient_scope', 'Esta conexión no tiene permiso para usar esta herramienta');
      if (!visible(who, definition)) throw new FlowtError('writes_disabled', 'Los cambios desde el conector están desactivados');
      // Enforce published JSON schemas at the transport boundary as well as domain checks.
      if (!valid(definition.inputSchema, args)) throw new FlowtError('invalid_arguments', 'La petición no cumple el contrato de la herramienta');
      return (access.service === 'finance' ? finance : reviews)[name](who.uid, args);
    }

    // --- OAuth: discovery, client registration, tokens and the consent screen API ---

    async function oauthEndpoint(handler) {
      if (!oauth) return json({ error: 'not_found' }, 404, cors);
      try {
        return await handler();
      } catch (error) {
        if (error instanceof OAuthError) return json({ ...error.body(), ...(error.redirect ? { redirect_to: error.redirect } : {}) }, error.status, cors);
        if (error instanceof FlowtError && error.code === 'unauthorized') return json({ error: 'unauthorized' }, 401, cors);
        if (error instanceof FlowtError) return json({ error: 'invalid_request', error_description: error.message }, 400, cors);
        console.error(JSON.stringify({ event: 'oauth_error', path }));
        return json({ error: 'server_error', error_description: 'No se pudo completar la operación' }, 503, cors);
      }
    }

    if (path.startsWith('/.well-known/oauth-protected-resource')) return oauthEndpoint(() => json(oauth.resourceMetadata(), 200, cors));
    if (path.startsWith('/.well-known/oauth-authorization-server')) return oauthEndpoint(() => json(oauth.metadata(), 200, cors));
    if (path === '/oauth/authorize' && request.method === 'GET') {
      // The consent screen lives in the web app; it validates the request through this service.
      return oauthEndpoint(() => new Response(null, { status: 302, headers: { Location: `${oauth.consentUrl}${url.search}` } }));
    }
    if (path.startsWith('/oauth/') || path.startsWith('/api/connections/')) {
      if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405, { ...cors, Allow: 'POST, OPTIONS' });
      return oauthEndpoint(async () => {
        if (path === '/oauth/register') return json(await oauth.register(await readJson(request)), 201, cors);
        if (path === '/oauth/token') return json(await oauth.token(await readForm(request)), 200, { ...cors, Pragma: 'no-cache' });
        if (path === '/oauth/revoke') {
          await oauth.revoke(await readForm(request));
          return json({}, 200, cors);
        }
        // Everything below is called by Flowt's own screens with the signed-in user's session.
        const owner = await webOwner();
        const body = await readJson(request);
        const invalid = () => new OAuthError('invalid_request', 'Petición no válida');
        if (path === '/api/connections/list') return json({ items: plain(await oauth.connections(owner)), mcp_url: oauth.resource }, 200, cors);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
        if (path === '/api/connections/revoke') return json({ revoked: await oauth.disconnect(owner, body.connection_id) }, 200, cors);
        if (path === '/oauth/authorize/preview') return json(await oauth.describe(body.params), 200, cors);
        if (path === '/oauth/authorize/decision' && typeof body.approve === 'boolean') {
          return json({ redirect_to: await oauth.decide(owner, body.params, body.approve, body.write !== false) }, 200, cors);
        }
        throw invalid();
      });
    }

    // --- Web review API -----------------------------------------------------

    if (path.startsWith('/api/reviews/')) {
      const action = path.slice('/api/reviews/'.length);
      if (request.method !== 'POST') return json({ error: 'not_found' }, 405, { ...cors, Allow: 'POST, OPTIONS' });
      if (!(action in REVIEW_ACTIONS) && action !== 'edit') return json({ error: 'not_found' }, 404, cors);
      try {
        if (action === 'edit') {
          const owner = await webOwner();
          const args = await readJson(request);
          if (!valid(EDIT_SCHEMA, args)) throw new FlowtError('invalid_arguments', 'La edición no cumple el contrato');
          return json(await reviews.edit_movement(owner, args), 200, cors);
        }
        const who = await principal();
        return json(await dispatch(who, REVIEW_ACTIONS[action], await readJson(request)), 200, cors);
      } catch (error) {
        if (error instanceof FlowtError) return json({ error: error.code, message: error.message }, error.code === 'unauthorized' ? 401 : 409, cors);
        console.error(JSON.stringify({ event: 'review_api_error', action }));
        return json({ error: 'retryable_error', message: 'No se pudo completar la operación' }, 503, cors);
      }
    }

    // --- MCP (Streamable HTTP, JSON responses) ------------------------------

    if (path !== '/mcp') return json({ error: 'not_found' }, 404, cors);
    let who;
    try {
      who = await principal();
    } catch (error) {
      if (!(error instanceof FlowtError)) console.error(JSON.stringify({ event: 'auth_error' }));
      // The challenge tells an MCP client where to start the OAuth flow.
      return json({ error: 'unauthorized' }, 401, { ...cors, ...(oauth ? { 'WWW-Authenticate': oauth.challenge() } : {}) });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST, OPTIONS' } });
    let message;
    try {
      message = await readJson(request);
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 413, cors);
    }
    const validId = (id) => id === null || typeof id === 'string' || typeof id === 'number';
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
        || ('id' in message && !validId(message.id))) {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400, cors);
    }
    const { method } = message;
    const protocol = request.headers.get('MCP-Protocol-Version') || PROTOCOLS[0];
    // The header carries the version agreed in initialize, so it can only be judged afterwards.
    if (method !== 'initialize' && !PROTOCOLS.includes(protocol)) return json({ error: 'unsupported_protocol' }, 400, cors);
    const params = message.params ?? {};
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      return json({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32602, message: 'Invalid params' } }, 400, cors);
    }
    if (!('id' in message)) return new Response(null, { status: method.startsWith('notifications/') ? 202 : 400, headers: cors });
    const response = { jsonrpc: '2.0', id: message.id };
    if (method === 'initialize') {
      response.result = { protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[PROTOCOLS.length - 1],
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'flowt', version: '1.0.0' }, instructions: INSTRUCTIONS };
    } else if (method === 'ping') {
      response.result = {};
    } else if (method === 'tools/list') {
      response.result = { tools: TOOLS.filter((definition) => visible(who, definition)) };
    } else if (method === 'tools/call') {
      const used = userLimiter.check(`user:${who.uid}`);
      if (!used.allowed) return json({ jsonrpc: '2.0', id: message.id, error: { code: -32029, message: 'Too many requests. Try again later.' } }, 429, { ...cors, 'Retry-After': String(used.retryAfterSec) });
      try {
        const result = await dispatch(who, params.name, params.arguments ?? {});
        response.result = { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
      } catch (error) {
        if (error instanceof FlowtError) {
          response.result = { content: [{ type: 'text', text: `${error.code}: ${error.message}` }], isError: true };
        } else {
          // Never echo internal errors: they may quote stored data or credentials.
          console.error(JSON.stringify({ event: 'tool_error', tool: String(params.name).slice(0, 80) }));
          response.result = { content: [{ type: 'text', text: 'retryable_error: Error técnico; reintenta la misma operación' }], isError: true };
        }
      }
    } else {
      response.error = { code: -32601, message: 'Method not found' };
    }
    return json(response, 200, cors);
  }

  return {
    async fetch(request, env = {}) {
      let response;
      try {
        response = await handle(request, env);
      } catch (error) {
        const tooLarge = error instanceof FlowtError && error.code === 'payload_too_large';
        if (!tooLarge) console.error(JSON.stringify({ event: 'unhandled_error' }));
        response = json({ error: tooLarge ? 'payload_too_large' : 'server_error' }, tooLarge ? 413 : 500);
      }
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      return response;
    },
  };
}

export default createWorker();
