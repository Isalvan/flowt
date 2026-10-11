// @vitest-environment node
/** The OAuth flow an MCP client follows, over the Worker's real routes. */
import { beforeEach, describe, expect, it } from 'vitest';
import { sameRedirect, validRedirect } from '../src/oauth.js';
import { APP, BASE, CALLBACK, VERIFIER, WEB, setup } from './harness.js';

let t;
beforeEach(() => { t = setup(); });

const query = (location) => Object.fromEntries(new URL(location).searchParams);
const refresh = (clientId, token, extra = {}) => t.send('/oauth/token', { form: { grant_type: 'refresh_token', client_id: clientId, refresh_token: token, ...extra } });
const later = (ms) => { t.clock.now = new Date(t.clock.now.getTime() + ms); };

describe('connecting an assistant', () => {
  it('discovers, registers, gets consent and calls tools', async () => {
    const challenge = await t.send('/mcp', { json: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
    const resource = (await t.send('/.well-known/oauth-protected-resource/mcp', { method: 'GET' })).data;
    expect(resource).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    const metadata = (await t.send('/.well-known/oauth-authorization-server', { method: 'GET' })).data;
    expect(metadata).toMatchObject({ issuer: BASE, authorization_endpoint: `${BASE}/oauth/authorize`, token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });

    const registered = await t.register();
    expect(registered.status).toBe(201);
    expect(registered.data).toMatchObject({ client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' });
    expect(registered.data).not.toHaveProperty('client_secret');
    const clientId = registered.data.client_id;

    // The browser is sent to Flowt's own consent screen with the request untouched.
    const search = `?${new URLSearchParams(t.requestParams(clientId))}`;
    const browser = await t.send(`/oauth/authorize${search}`, { method: 'GET' });
    expect(browser.status).toBe(302);
    expect(browser.headers.get('Location')).toBe(`${APP}/conectar${search}`);

    const preview = await t.send('/oauth/authorize/preview', { headers: WEB, json: { params: t.requestParams(clientId) } });
    expect(preview.data).toEqual({ client_name: 'Claude', scopes: ['flowt:read', 'flowt:write'], redirect_host: 'claude.ai', local: false });
    const decision = await t.send('/oauth/authorize/decision', { headers: WEB, json: { params: t.requestParams(clientId), approve: true } });
    const back = new URL(decision.data.redirect_to);
    expect(`${back.origin}${back.pathname}`).toBe(CALLBACK);
    expect(query(decision.data.redirect_to)).toMatchObject({ state: 'xyz', iss: BASE });
    const code = back.searchParams.get('code');
    const tokens = await t.exchange(clientId, code);
    expect(tokens.status).toBe(200);
    expect(tokens.headers.get('Cache-Control')).toBe('no-store');
    expect(tokens.data).toMatchObject({ token_type: 'Bearer', scope: 'flowt:read flowt:write', expires_in: 3600 });

    const access = tokens.data.access_token;
    expect(await t.toolNames(access)).toEqual(expect.arrayContaining(['get_overview', 'create_movement', 'delete_movement', 'apply_review']));
    const overview = await t.tool(access, 'get_overview');
    expect(overview.isError).toBe(false);
    expect(overview.structuredContent.total_balance).toBe(100);
    expect(JSON.parse(overview.content[0].text)).toEqual(overview.structuredContent);
    const created = await t.tool(access, 'create_movement', { tipo: 'gasto', concepto: 'Café', importe: 2.5, fecha_operacion: '2026-10-10' });
    expect(created.isError).toBe(false);
    expect(t.db.read('huchas', 'main').saldo_acumulado).toBe(97.5);
    // Nothing readable is stored: only digests of the secrets handed to the client.
    const stored = JSON.stringify(t.db.snapshotAll());
    for (const secret of [access, tokens.data.refresh_token, code]) expect(stored).not.toContain(secret);
  });

  it('accepts a code once, and a replay ends the connection', async () => {
    const clientId = (await t.register()).data.client_id;
    const code = await t.authorize(clientId);
    const access = (await t.exchange(clientId, code)).data.access_token;
    expect((await t.rpc(access)).status).toBe(200);
    const replay = await t.exchange(clientId, code);
    expect([replay.status, replay.data.error]).toEqual([400, 'invalid_grant']);
    expect((await t.rpc(access)).status).toBe(401);
  });

  it.each([
    [{ code_verifier: 'w'.repeat(64) }], [{ code_verifier: 'short' }], [{ redirect_uri: 'https://claude.ai/other' }],
    [{ code: 'flowt_ac_unknown' }], [{ resource: 'https://elsewhere.example/mcp' }],
  ])('rejects a token exchange that does not match the consent %o', async (overrides) => {
    const clientId = (await t.register()).data.client_id;
    const code = await t.authorize(clientId);
    const response = await t.exchange(clientId, code, overrides);
    expect(response.status).toBe(400);
    expect(['invalid_grant', 'invalid_target']).toContain(response.data.error);
    expect(t.db.all('oauth_tokens')).toEqual({});
  });

  it('expires codes and ties them to the client that asked', async () => {
    const clientId = (await t.register()).data.client_id;
    const otherId = (await t.register()).data.client_id;
    expect((await t.exchange(otherId, await t.authorize(clientId))).data.error).toBe('invalid_grant');
    const code = await t.authorize(clientId);
    later(5 * 60_000 + 1);
    expect((await t.exchange(clientId, code)).data.error).toBe('invalid_grant');
    expect((await t.exchange('flowt-unknown', code)).status).toBe(401);
  });

  it('takes the token request as JSON too', async () => {
    const clientId = (await t.register()).data.client_id;
    const code = await t.authorize(clientId);
    const response = await t.send('/oauth/token', { json: { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CALLBACK } });
    expect(response.status).toBe(200);
    expect(response.data.access_token).toMatch(/^flowt_at_/);
  });
});

describe('what a connection may do', () => {
  it('cannot change anything with read-only consent', async () => {
    const { tokens } = await t.connect({ write: false });
    expect(tokens.scope).toBe('flowt:read');
    const names = await t.toolNames(tokens.access_token);
    expect(names).toEqual(expect.arrayContaining(['list_movements', 'list_pending_reviews']));
    for (const name of ['create_movement', 'delete_movement', 'apply_review', 'update_movement', 'archive_hucha']) expect(names).not.toContain(name);
    for (const [name, args] of [['create_movement', { tipo: 'gasto', concepto: 'Café', importe: 2, fecha_operacion: '2026-10-10' }], ['revert_review', { review_id: 'r' }]]) {
      const result = await t.tool(tokens.access_token, name, args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^insufficient_scope:/);
    }
    expect(t.db.read('huchas', 'main').saldo_acumulado).toBe(100);
  });

  it('only reaches the data of the user who approved it', async () => {
    t.db.put('huchas', 'theirs', { id_propietario: 'other', nombre: 'Ajena', tipo_aportacion: 'resto', saldo_acumulado: 7, orden: 1 });
    const { tokens } = await t.connect({ headers: { ...WEB, Authorization: 'Bearer firebase-other' } });
    expect((await t.tool(tokens.access_token, 'list_huchas')).structuredContent.items.map((h) => h.id)).toEqual(['theirs']);
    // The owner is the signed-in user of the consent screen; a tool argument cannot change it.
    expect((await t.tool(tokens.access_token, 'list_huchas', { owner: 'owner' })).isError).toBe(true);
  });

  it('can be switched to read-only for everyone', async () => {
    const { tokens } = await t.connect();
    t.env.FLOWT_MCP_WRITES_ENABLED = 'false';
    const names = await t.toolNames(tokens.access_token);
    expect(names).toContain('list_movements');
    expect(names).not.toContain('create_movement');
    const result = await t.tool(tokens.access_token, 'transfer_between_huchas', { from_hucha_id: 'main', to_hucha_id: 'x', importe: 1 });
    expect(result.content[0].text).toMatch(/^writes_disabled:/);
    expect(t.db.read('huchas', 'main').saldo_acumulado).toBe(100);
  });
});

describe('token lifetime', () => {
  it('rotates on refresh, tolerates a retry and detects a stolen token', async () => {
    const { clientId, tokens } = await t.connect();
    const renewed = await refresh(clientId, tokens.refresh_token);
    expect(renewed.status).toBe(200);
    expect(renewed.data.refresh_token).not.toBe(tokens.refresh_token);
    expect((await t.rpc(renewed.data.access_token)).status).toBe(200);
    // The response was lost and the client retries with the token it still has.
    expect((await refresh(clientId, tokens.refresh_token)).status).toBe(200);
    expect((await refresh(clientId, 'flowt_rt_unknown')).data.error).toBe('invalid_grant');
    later(5 * 60_000);
    expect((await refresh(clientId, tokens.refresh_token)).data.error).toBe('invalid_grant');
    expect((await t.rpc(renewed.data.access_token)).status).toBe(401);
    expect((await refresh(clientId, renewed.data.refresh_token)).data.error).toBe('invalid_grant');
    expect(t.db.all('oauth_grants')).toEqual({});
  });

  it('stops honouring expired access tokens and prunes them', async () => {
    const { clientId, tokens } = await t.connect();
    later(3600_000 + 1);
    expect((await t.rpc(tokens.access_token)).status).toBe(401);
    expect((await refresh(clientId, tokens.refresh_token)).status).toBe(200);
    expect(Object.values(t.db.all('oauth_tokens')).every((token) => token.expires_at > t.clock.now)).toBe(true);
    expect(t.db.all('oauth_codes')).toEqual({});
  });

  it('lets a client revoke its own tokens', async () => {
    const { clientId, tokens } = await t.connect();
    expect((await t.send('/oauth/revoke', { form: { client_id: clientId, token: 'flowt_at_unknown' } })).status).toBe(200);
    expect((await t.rpc(tokens.access_token)).status).toBe(200);
    expect((await t.send('/oauth/revoke', { form: { client_id: clientId, token: tokens.refresh_token } })).status).toBe(200);
    expect((await t.rpc(tokens.access_token)).status).toBe(401);
  });
});

describe('the consent screen', () => {
  it('requires the Flowt session and the Flowt origin', async () => {
    const { clientId, tokens } = await t.connect();
    const body = { params: t.requestParams(clientId), approve: true };
    expect((await t.send('/oauth/authorize/decision', { json: body })).status).toBe(401);
    // A connected app cannot approve further connections with its own token.
    expect((await t.send('/oauth/authorize/decision', { json: body, headers: { Authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);
    expect((await t.send('/oauth/authorize/decision', { json: body, headers: { ...WEB, Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await t.send('/api/connections/list', { json: {}, headers: { Authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);
  });

  it('reports a denial and never redirects to an unregistered address', async () => {
    const clientId = (await t.register()).data.client_id;
    const denied = await t.send('/oauth/authorize/decision', { headers: WEB, json: { params: t.requestParams(clientId), approve: false } });
    expect(query(denied.data.redirect_to)).toEqual({ error: 'access_denied', state: 'xyz', iss: BASE });
    expect(t.db.all('oauth_codes')).toEqual({});
    // A wrong return address is never redirected to: the user just sees the error.
    for (const overrides of [{ redirect_uri: 'https://evil.example/cb' }, { client_id: 'flowt-unknown' }]) {
      const wrong = await t.send('/oauth/authorize/preview', { headers: WEB, json: { params: t.requestParams(clientId, overrides) } });
      expect(wrong.status).toBe(400);
      expect(wrong.data).not.toHaveProperty('redirect_to');
    }
    // Other mistakes are reported back to the registered client.
    for (const overrides of [{ code_challenge_method: 'plain' }, { response_type: 'token' }, { resource: 'https://elsewhere.example' }]) {
      const wrong = await t.send('/oauth/authorize/preview', { headers: WEB, json: { params: t.requestParams(clientId, overrides) } });
      expect(wrong.status).toBe(400);
      expect(wrong.data.redirect_to.startsWith(`${CALLBACK}?error=`)).toBe(true);
    }
    expect((await t.send('/oauth/authorize/preview', { headers: WEB, json: { params: { client_id: 5 } } })).status).toBe(400);
    expect((await t.send('/oauth/authorize/decision', { headers: WEB, json: { params: t.requestParams(clientId) } })).status).toBe(400);
  });

  it('lets the user see and revoke connections', async () => {
    const { tokens } = await t.connect();
    const listed = (await t.send('/api/connections/list', { json: {}, headers: WEB })).data;
    expect(listed.mcp_url).toBe(`${BASE}/mcp`);
    expect(listed.items).toHaveLength(1);
    const [connection] = listed.items;
    expect(connection).toMatchObject({ client_name: 'Claude', redirect_host: 'claude.ai', scopes: ['flowt:read', 'flowt:write'] });
    expect(connection).not.toHaveProperty('id_propietario');
    expect(typeof connection.created_at).toBe('string');
    const stranger = { ...WEB, Authorization: 'Bearer firebase-other' };
    expect((await t.send('/api/connections/list', { json: {}, headers: stranger })).data.items).toEqual([]);
    expect((await t.send('/api/connections/revoke', { json: { connection_id: connection.id }, headers: stranger })).data).toEqual({ revoked: false });
    expect((await t.rpc(tokens.access_token)).status).toBe(200);
    expect((await t.send('/api/connections/revoke', { json: { connection_id: connection.id }, headers: WEB })).data).toEqual({ revoked: true });
    expect((await t.rpc(tokens.access_token)).status).toBe(401);
    expect(t.db.all('oauth_tokens')).toEqual({});
    expect(t.db.all('oauth_grants')).toEqual({});
  });
});

describe('client registration', () => {
  it('registers every client as public, whatever it asks for', async () => {
    const registered = (await t.register({ token_endpoint_auth_method: 'client_secret_post' })).data;
    expect(registered.token_endpoint_auth_method).toBe('none');
    expect(registered).not.toHaveProperty('client_secret');
    expect((await t.exchange(registered.client_id, await t.authorize(registered.client_id))).status).toBe(200);
  });

  it('lets native clients listen on any loopback port', async () => {
    const clientId = (await t.register({ client_name: 'Claude Code', redirect_uris: ['http://localhost:1234/callback'] })).data.client_id;
    const params = t.requestParams(clientId, { redirect_uri: 'http://localhost:54321/callback' });
    const preview = await t.send('/oauth/authorize/preview', { headers: WEB, json: { params } });
    expect(preview.data).toMatchObject({ redirect_host: 'localhost', local: true });
    const decision = await t.send('/oauth/authorize/decision', { headers: WEB, json: { params, approve: true } });
    expect(decision.data.redirect_to.startsWith('http://localhost:54321/callback?code=')).toBe(true);
  });

  it.each([
    [{ redirect_uris: [] }], [{ redirect_uris: ['http://evil.example/cb'] }], [{ redirect_uris: ['javascript:alert(1)'] }],
    [{ redirect_uris: ['https://ok.example/cb#fragment'] }], [{ redirect_uris: Array(11).fill('https://ok.example/cb') }],
    [{ redirect_uris: ['https://user:pass@ok.example/cb'] }], [{ grant_types: ['client_credentials'] }],
    [{ grant_types: ['authorization_code', 'password'] }], [{ response_types: ['token'] }],
  ])('rejects unsafe metadata %o', async (metadata) => {
    const response = await t.register(metadata);
    expect(response.status).toBe(400);
    expect(['invalid_redirect_uri', 'invalid_client_metadata']).toContain(response.data.error);
    expect(t.db.all('oauth_clients')).toEqual({});
  });

  it('strips markup from the name shown on the consent screen', async () => {
    expect((await t.register({ client_name: '<b>Claude</b>\u0000' })).data.client_name).toBe('bClaude/b');
  });

  it('applies the redirect rules', () => {
    for (const good of [CALLBACK, 'http://127.0.0.1:8976/cb', 'cursor://anysphere.cursor-mcp/oauth/callback']) expect(validRedirect(good)).toBe(true);
    for (const bad of ['http://example.com/cb', 'data:text/html,x', 'file:///etc/passwd', 'https://a b.example/', 'not a url', '', null]) expect(validRedirect(bad)).toBe(false);
    expect(sameRedirect('http://localhost:5/cb', 'http://localhost:9/cb')).toBe(true);
    expect(sameRedirect('http://localhost:5/other', 'http://localhost:9/cb')).toBe(false);
    expect(sameRedirect('https://claude.ai:444/api/mcp/auth_callback', CALLBACK)).toBe(false);
  });
});

describe('deployment switches', () => {
  it('answers public OAuth endpoints from any origin, but not the MCP endpoint', async () => {
    const elsewhere = { Origin: 'https://inspector.example' };
    const metadata = await t.send('/.well-known/oauth-authorization-server', { method: 'GET', headers: elsewhere });
    expect([metadata.status, metadata.headers.get('Access-Control-Allow-Origin')]).toEqual([200, '*']);
    expect((await t.send('/oauth/token', { method: 'OPTIONS', headers: elsewhere })).status).toBe(204);
    expect((await t.register({}, elsewhere)).status).toBe(201);
    expect((await t.send('/mcp', { json: {}, headers: elsewhere })).status).toBe(403);
  });

  it('has no OAuth without the web address, and keeps the fixed token to the review tools', async () => {
    t = setup({ APP_URL: '', FLOWT_MCP_TOKEN: 'p'.repeat(40), FLOWT_MCP_OWNER_UID: 'owner' });
    expect((await t.send('/.well-known/oauth-protected-resource', { method: 'GET' })).status).toBe(404);
    expect((await t.register()).status).toBe(404);
    const unauthorized = await t.send('/mcp', { json: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('WWW-Authenticate')).toBeNull();
    const names = await t.toolNames('p'.repeat(40));
    expect(names).toEqual(expect.arrayContaining(['apply_review', 'list_pending_reviews']));
    expect(names).not.toContain('create_movement');
    expect(names).not.toContain('get_overview');
    for (const [name, args] of [['get_overview', {}], ['update_movement', { movement_id: 'm', name: 'Manual' }]]) {
      expect((await t.tool('p'.repeat(40), name, args)).content[0].text).toMatch(/^insufficient_scope:/);
    }
    expect((await t.rpc('p'.repeat(39))).status).toBe(401);
  });
});
