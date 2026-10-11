/**
 * OAuth 2.1 authorization server for the Flowt MCP connector.
 *
 * An MCP client registers itself, sends the user to Flowt's consent screen and
 * exchanges the resulting code for tokens, so nobody copies a secret by hand.
 * The user proves who they are with their Flowt (Firebase) session on that
 * screen; this module never sees a password. Codes and tokens are opaque random
 * strings stored only as SHA-256 digests, bound to one client and to this server.
 *
 * Implements what the MCP authorization spec asks of a server: protected resource
 * metadata (RFC 9728), authorization server metadata (RFC 8414), dynamic client
 * registration (RFC 7591) for public clients, PKCE with S256, resource indicators
 * (RFC 8707), rotating refresh tokens and revocation (RFC 7009).
 */
import { OAuthError } from './errors.js';
import { DELETE_FIELD, SERVER_TIMESTAMP } from './firestore.js';
import { randomToken, sameSecret, sha256Base64Url, sha256Hex } from './util.js';

export const SCOPE_READ = 'flowt:read';
export const SCOPE_WRITE = 'flowt:write';
export const SCOPES = [SCOPE_READ, SCOPE_WRITE];
const ACCESS_TTL = 3600_000;
const REFRESH_TTL = 90 * 86_400_000;
const CODE_TTL = 5 * 60_000;
const UNUSED_CLIENT_TTL = 30 * 86_400_000;
// A client that retries a refresh after a lost response must not lose its connection.
const REFRESH_GRACE = 60_000;
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const BLOCKED_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:'];
const NOW = SERVER_TIMESTAMP;
const OWNER = 'id_propietario';

/** HTTPS, loopback HTTP, or a native app's private scheme (RFC 8252). Never script-like schemes. */
export function validRedirect(uri) {
  // eslint-disable-next-line no-control-regex
  if (typeof uri !== 'string' || !uri || uri.length > 2000 || /[\x00-\x20]/.test(uri)) return false;
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || uri.includes('#') || url.username || url.password || BLOCKED_SCHEMES.includes(url.protocol)) return false;
  if (url.protocol === 'https:') return Boolean(url.hostname);
  if (url.protocol === 'http:') return LOOPBACK.includes(url.hostname);
  return true;
}

export function sameRedirect(requested, registered) {
  if (requested === registered) return true;
  try {
    const [a, b] = [new URL(requested), new URL(registered)];
    // Native clients listen on an ephemeral loopback port, so the port is not compared.
    return a.protocol === 'http:' && b.protocol === 'http:' && LOOPBACK.includes(a.hostname) && a.hostname === b.hostname
      && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

function withQuery(uri, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null)).toString();
  return `${uri}${uri.includes('?') ? '&' : '?'}${query}`;
}

export class AuthorizationServer {
  /**
   * @param {object} db
   * @param {{ issuer: string, consentUrl: string, now?: () => Date }} settings
   *   issuer: public origin of this service; consentUrl: Flowt screen where the user approves.
   */
  constructor(db, { issuer, consentUrl, now = () => new Date() }) {
    this.db = db;
    this.issuer = issuer.replace(/\/$/, '');
    this.resource = `${this.issuer}/mcp`;
    this.consentUrl = consentUrl;
    this.now = now;
  }

  _ref(collection, key) {
    return this.db.doc(collection, key);
  }

  _later(ms) {
    return new Date(this.now().getTime() + ms);
  }

  // --- Discovery ----------------------------------------------------------

  resourceMetadata() {
    return { resource: this.resource, authorization_servers: [this.issuer], scopes_supported: SCOPES,
      bearer_methods_supported: ['header'], resource_name: 'Flowt' };
  }

  metadata() {
    return { issuer: this.issuer, authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`, registration_endpoint: `${this.issuer}/oauth/register`,
      revocation_endpoint: `${this.issuer}/oauth/revoke`, scopes_supported: SCOPES,
      response_types_supported: ['code'], response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true };
  }

  /** Value of WWW-Authenticate that lets an MCP client start the flow on its own. */
  challenge(extra = '') {
    return `Bearer resource_metadata="${this.issuer}/.well-known/oauth-protected-resource/mcp", scope="${SCOPES.join(' ')}"${extra}`;
  }

  // --- Dynamic client registration ----------------------------------------

  async register(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new OAuthError('invalid_client_metadata', 'Se esperaba un objeto JSON');
    const redirects = payload.redirect_uris;
    if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 10 || !redirects.every(validRedirect)) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris debe contener URL https, de loopback o de app nativa');
    }
    const grants = payload.grant_types ?? ['authorization_code', 'refresh_token'];
    const responses = payload.response_types ?? ['code'];
    if (!Array.isArray(grants) || !grants.includes('authorization_code') || grants.some((g) => !['authorization_code', 'refresh_token'].includes(g))
        || !Array.isArray(responses) || responses.length !== 1 || responses[0] !== 'code') {
      throw new OAuthError('invalid_client_metadata', 'Solo se admite el flujo authorization_code con PKCE');
    }
    // eslint-disable-next-line no-control-regex
    const name = typeof payload.client_name === 'string' ? payload.client_name.replace(/[\x00-\x1f\x7f-\x9f<>]/g, '').trim().slice(0, 80) : '';
    const clientId = `flowt-${randomToken(18)}`;
    const client = { client_name: name || 'Cliente MCP', redirect_uris: [...new Set(redirects)], created_at: NOW, expires_at: this._later(UNUSED_CLIENT_TTL) };
    await this.db.batch((batch) => batch.create(this._ref('oauth_clients', clientId), client));
    // Every client is public: PKCE protects the code, so a requested secret is not issued.
    return { client_id: clientId, client_id_issued_at: Math.floor(this.now().getTime() / 1000), client_name: client.client_name,
      redirect_uris: client.redirect_uris, token_endpoint_auth_method: 'none', grant_types: grants, response_types: ['code'] };
  }

  async _client(clientId, tx = null) {
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(clientId)) return null;
    const snapshot = await this.db.get(this._ref('oauth_clients', clientId), tx);
    return snapshot.exists ? snapshot.data : null;
  }

  // --- Authorization request (driven by the consent screen) ---------------

  /** Validate an authorization request exactly as received by the consent screen. */
  async _request(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params) || !Object.values(params).every((value) => typeof value === 'string')) {
      throw new OAuthError('invalid_request', 'Petición de autorización no válida');
    }
    const client = await this._client(params.client_id);
    if (!client) throw new OAuthError('invalid_client', 'Esta aplicación no está registrada en Flowt. Vuelve a conectarla desde el principio.');
    const redirect = params.redirect_uri || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : null);
    if (!redirect || !validRedirect(redirect) || !client.redirect_uris.some((registered) => sameRedirect(redirect, registered))) {
      throw new OAuthError('invalid_request', 'La dirección de retorno no coincide con la registrada por la aplicación.');
    }
    let state = params.state ?? null;
    const reject = (error, description) => {
      throw new OAuthError(error, description, 400, withQuery(redirect, { error, error_description: description, state, iss: this.issuer }));
    };
    if (state !== null && state.length > 2000) {
      state = null;
      reject('invalid_request', 'state demasiado largo');
    }
    if (params.response_type !== 'code') reject('unsupported_response_type', 'Solo se admite response_type=code');
    const challenge = params.code_challenge || '';
    if (params.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) reject('invalid_request', 'Se requiere PKCE con S256');
    const resource = params.resource;
    if (resource !== undefined && ![this.resource, this.issuer].includes(resource.replace(/\/$/, ''))) reject('invalid_target', 'El recurso solicitado no es este servidor');
    const requested = (params.scope || '').split(/\s+/).filter((scope) => SCOPES.includes(scope));
    return { client_id: params.client_id, client_name: client.client_name, redirect_uri: redirect, state, code_challenge: challenge,
      scopes: requested.length ? requested : [...SCOPES] };
  }

  async describe(params) {
    const request = await this._request(params);
    const target = new URL(request.redirect_uri);
    return { client_name: request.client_name, scopes: request.scopes, redirect_host: target.hostname || target.protocol,
      local: LOOPBACK.includes(target.hostname) };
  }

  /** The signed-in user's answer. Returns the URL that takes them back to the client. */
  async decide(owner, params, approve, write = true) {
    const request = await this._request(params);
    const back = { state: request.state, iss: this.issuer };
    if (!approve) return withQuery(request.redirect_uri, { error: 'access_denied', ...back });
    const scopes = request.scopes.filter((scope) => scope !== SCOPE_WRITE || write);
    if (!scopes.includes(SCOPE_READ)) scopes.unshift(SCOPE_READ);
    const code = `flowt_ac_${randomToken()}`;
    const digest = await sha256Hex(code);
    await this.db.batch((batch) => batch.create(this._ref('oauth_codes', digest), {
      [OWNER]: owner, client_id: request.client_id, client_name: request.client_name, redirect_uri: request.redirect_uri,
      code_challenge: request.code_challenge, scopes, used: false, created_at: NOW, expires_at: this._later(CODE_TTL) }));
    return withQuery(request.redirect_uri, { code, ...back });
  }

  // --- Token endpoint -----------------------------------------------------

  async _issue(tx, owner, clientId, grantId, scopes) {
    const access = `flowt_at_${randomToken()}`;
    const refresh = `flowt_rt_${randomToken()}`;
    const base = { [OWNER]: owner, client_id: clientId, grant_id: grantId, scopes, resource: this.resource, created_at: NOW };
    tx.set(this._ref('oauth_tokens', await sha256Hex(access)), { ...base, kind: 'access', expires_at: this._later(ACCESS_TTL) });
    tx.set(this._ref('oauth_tokens', await sha256Hex(refresh)), { ...base, kind: 'refresh', expires_at: this._later(REFRESH_TTL) });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: scopes.join(' ') };
  }

  async _grantTokens(grantId, tx = null) {
    return (await this.db.query({ collection: 'oauth_tokens', where: [['grant_id', '==', grantId]] }, tx)).map((snapshot) => snapshot.ref);
  }

  /** `form` holds the request parameters, whether they came as a form or as JSON. */
  async token(form) {
    const clientId = form.client_id;
    if (!(await this._client(clientId))) throw new OAuthError('invalid_client', 'Cliente desconocido', 401);
    let result;
    if (form.grant_type === 'authorization_code') result = await this.db.runTransaction((tx) => this._redeem(tx, clientId, form));
    else if (form.grant_type === 'refresh_token') result = await this.db.runTransaction((tx) => this._refresh(tx, clientId, form));
    else throw new OAuthError('unsupported_grant_type', 'Solo authorization_code y refresh_token');
    // Rejections are returned, not thrown, so the cleanup they decide on is committed.
    if (result instanceof OAuthError) throw result;
    await this.prune().catch(() => {}); // Housekeeping must never fail a login.
    return result;
  }

  async _redeem(tx, clientId, form) {
    const invalid = new OAuthError('invalid_grant', 'Código de autorización no válido o caducado');
    const { code, code_verifier: verifier } = form;
    if (typeof code !== 'string' || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return invalid;
    const codeRef = this._ref('oauth_codes', await sha256Hex(code));
    const snapshot = await this.db.get(codeRef, tx);
    const stored = snapshot.exists ? snapshot.data : null;
    if (!stored || stored.client_id !== clientId) return invalid;
    if (stored.used) {
      // A code presented twice was probably intercepted: drop everything it produced.
      if (stored.grant_id) {
        const tokens = await this._grantTokens(stored.grant_id, tx);
        for (const ref of tokens) tx.delete(ref);
        tx.delete(this._ref('oauth_grants', stored.grant_id));
      }
      return invalid;
    }
    const redirect = form.redirect_uri;
    if (stored.expires_at <= this.now() || !sameSecret(await sha256Base64Url(verifier), stored.code_challenge)
        || (redirect != null && redirect !== stored.redirect_uri)) return invalid;
    const resource = form.resource;
    if (resource != null && ![this.resource, this.issuer].includes(String(resource).replace(/\/$/, ''))) {
      return new OAuthError('invalid_target', 'El recurso solicitado no es este servidor');
    }
    const grantId = randomToken(18);
    let host = null;
    try {
      host = new URL(stored.redirect_uri).hostname || null;
    } catch { /* stored redirects are always valid */ }
    tx.set(this._ref('oauth_grants', grantId), { [OWNER]: stored[OWNER], client_id: clientId, client_name: stored.client_name ?? null,
      scopes: stored.scopes, redirect_host: host, created_at: NOW, last_used_at: NOW });
    tx.update(codeRef, { used: true, grant_id: grantId });
    tx.update(this._ref('oauth_clients', clientId), { expires_at: DELETE_FIELD });
    return this._issue(tx, stored[OWNER], clientId, grantId, stored.scopes);
  }

  async _refresh(tx, clientId, form) {
    const invalid = new OAuthError('invalid_grant', 'Token de renovación no válido o caducado');
    const token = form.refresh_token;
    if (typeof token !== 'string') return invalid;
    const tokenRef = this._ref('oauth_tokens', await sha256Hex(token));
    const snapshot = await this.db.get(tokenRef, tx);
    const stored = snapshot.exists ? snapshot.data : null;
    if (!stored || stored.kind !== 'refresh' || stored.client_id !== clientId || stored.expires_at <= this.now()) return invalid;
    const grantRef = this._ref('oauth_grants', stored.grant_id);
    if (!(await this.db.get(grantRef, tx)).exists) return invalid;
    const rotated = stored.rotated_at ?? null;
    if (rotated && this.now().getTime() - rotated.getTime() > REFRESH_GRACE) {
      // An old refresh token long after its rotation means it leaked: end the connection.
      const tokens = await this._grantTokens(stored.grant_id, tx);
      for (const ref of tokens) tx.delete(ref);
      tx.delete(grantRef);
      return invalid;
    }
    let scopes = stored.scopes;
    if (typeof form.scope === 'string' && form.scope) {
      const narrowed = scopes.filter((scope) => form.scope.split(/\s+/).includes(scope));
      if (narrowed.length) scopes = narrowed;
    }
    if (!rotated) tx.update(tokenRef, { rotated_at: this.now(), expires_at: this._later(86_400_000) });
    tx.update(grantRef, { last_used_at: NOW });
    return this._issue(tx, stored[OWNER], clientId, stored.grant_id, scopes);
  }

  /** Delete expired tokens, codes, never-used clients and idempotency records. */
  async prune(limit = 100) {
    const expired = (await Promise.all(['oauth_tokens', 'oauth_codes', 'oauth_clients', 'mcp_operations'].map((collection) =>
      this.db.query({ collection, where: [['expires_at', '<', this.now()]], limit })))).flat();
    if (expired.length) await this.db.batch((batch) => expired.forEach((snapshot) => batch.delete(snapshot.ref)));
    return expired.length;
  }

  /** RFC 7009: revoking any token of a connection ends that connection. */
  async revoke(form) {
    if (!(await this._client(form.client_id))) throw new OAuthError('invalid_client', 'Cliente desconocido', 401);
    if (typeof form.token !== 'string') return;
    const snapshot = await this.db.get(this._ref('oauth_tokens', await sha256Hex(form.token)));
    if (snapshot.exists && snapshot.data.client_id === form.client_id) await this._end(snapshot.data.grant_id);
  }

  async _end(grantId) {
    const tokens = await this._grantTokens(grantId);
    await this.db.batch((batch) => {
      tokens.forEach((ref) => batch.delete(ref));
      batch.delete(this._ref('oauth_grants', grantId));
    });
  }

  // --- Resource server ----------------------------------------------------

  /** { uid, scopes } for a live access token issued for this server, else null. */
  async authenticate(token) {
    if (typeof token !== 'string' || !token.startsWith('flowt_at_')) return null;
    const snapshot = await this.db.get(this._ref('oauth_tokens', await sha256Hex(token)));
    const stored = snapshot.exists ? snapshot.data : null;
    if (!stored || stored.kind !== 'access' || stored.expires_at <= this.now() || stored.resource !== this.resource) return null;
    return { uid: stored[OWNER], scopes: stored.scopes };
  }

  // --- The user's connections (settings screen) ---------------------------

  async connections(owner) {
    const rows = await this.db.query({ collection: 'oauth_grants', where: [[OWNER, '==', owner]] });
    return rows
      .map((snapshot) => ({ id: snapshot.id, ...Object.fromEntries(Object.entries(snapshot.data).filter(([key]) => key !== OWNER)) }))
      .sort((a, b) => (b.created_at?.getTime?.() ?? 0) - (a.created_at?.getTime?.() ?? 0));
  }

  async disconnect(owner, grantId) {
    if (typeof grantId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(grantId)) return false;
    const snapshot = await this.db.get(this._ref('oauth_grants', grantId));
    if (!snapshot.exists || snapshot.data[OWNER] !== owner) return false;
    await this._end(grantId);
    return true;
  }
}
