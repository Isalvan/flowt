// @vitest-environment node
/** The MCP transport and the web review API of the Worker. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS } from '../src/worker.js';
import { documentId } from '../src/util.js';
import { APP, BASE, WEB, setup } from './harness.js';

const FIREBASE = 'firebase-owner';
let t;
let proposal;

beforeEach(async () => {
  t = setup();
  t.db.put('huchas', 'food', { id_propietario: 'owner', nombre: 'Comida', tipo_aportacion: 'flat', valor_aportacion: 0, saldo_acumulado: 50, orden: 2 });
  t.db.put('movimientos', 'm', { id_propietario: 'owner', email_id: 'email', tipo: 'gasto', concepto: 'Bank charge', importe: 12, hucha_id: 'main',
    fecha_operacion: new Date('2026-10-03T00:00:00Z'), review_version: 0, moneda: 'EUR' });
  t.db.put('review_configuration', 'owner', { revision: 1, category_huchas: { alimentacion: 'food' } });
  t.db.put('email_processing', 'receipt', { id_propietario: 'owner', state: 'completed', movement_ids: ['m'] });
  t.db.put('review_jobs', await documentId('owner', 'm'), { id_propietario: 'owner', movement_id: 'm', processing_id: 'receipt', state: 'pending' });
  proposal = { expected_version: t.db.versions.get('movimientos/m'), configuration_revision: 1, operation_id: 'op', reason: 'Recibo del pedido',
    name: 'Compra semanal', category: 'alimentacion' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const web = (path, json, headers = WEB) => t.send(path, { json, headers });

describe('authentication', () => {
  it.each([['get_finance_configuration', {}], ['apply_review', { movement_id: 'm', proposal: {} }], ['revert_review', { review_id: 'r' }]])(
    'requires credentials for %s', async (name, args) => {
      const before = t.db.snapshotAll();
      const response = await t.rpc(null, 'tools/call', { name, arguments: args });
      expect([response.status, response.data]).toEqual([401, { error: 'unauthorized' }]);
      expect(t.db.snapshotAll()).toEqual(before);
    });

  it('requires credentials for the web API', async () => {
    for (const [action, args] of [['history', {}], ['revert', { review_id: 'r' }], ['edit', { movement_id: 'm', name: 'x' }]]) {
      expect((await t.send(`/api/reviews/${action}`, { json: args })).status).toBe(401);
    }
    expect((await t.rpc('not-a-token')).status).toBe(401);
    expect((await t.rpc('flowt_at_made-up')).status).toBe(401);
  });

  it('allows only the web app origin on the MCP endpoint and the web API', async () => {
    const stranger = { Origin: 'https://other.example' };
    expect((await t.rpc(FIREBASE, 'tools/list', {}, stranger)).status).toBe(403);
    expect((await t.send('/mcp', { method: 'OPTIONS', headers: stranger })).status).toBe(403);
    const preflight = await t.send('/api/reviews/history', { method: 'OPTIONS', headers: { Origin: APP } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect((await t.rpc(FIREBASE, 'tools/list', {}, { Origin: APP })).status).toBe(200);
    t.env.ALLOWED_ORIGINS = 'https://staging.flowt.example, https://other.example';
    expect((await t.rpc(FIREBASE, 'tools/list', {}, stranger)).status).toBe(200);
  });

  it('acts as the verified user, never as a user named in the arguments', async () => {
    t.db.put('huchas', 'theirs', { id_propietario: 'other', nombre: 'Ajena', saldo_acumulado: 7, orden: 1 });
    const mine = await t.tool(FIREBASE, 'list_huchas');
    expect(mine.structuredContent.items.map((h) => h.id)).toEqual(['main', 'food']);
    expect((await t.tool('firebase-other', 'list_huchas')).structuredContent.items.map((h) => h.id)).toEqual(['theirs']);
    const response = await t.rpc(FIREBASE);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('protocol', () => {
  it.each(['2025-03-26', '2025-06-18', '2025-11-25'])('initialises, pings and lists tools on %s', async (protocol) => {
    const headers = { 'MCP-Protocol-Version': protocol };
    const initialized = await t.rpc(FIREBASE, 'initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'test', version: '1' } }, headers);
    expect(initialized.status).toBe(200);
    expect(initialized.data.result).toMatchObject({ protocolVersion: protocol, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'flowt' } });
    const notified = await t.send('/mcp', { json: { jsonrpc: '2.0', method: 'notifications/initialized' }, headers: { Authorization: `Bearer ${FIREBASE}`, ...headers } });
    expect([notified.status, notified.text]).toEqual([202, '']);
    expect((await t.rpc(FIREBASE, 'ping', {}, headers)).data.result).toEqual({});
    const tools = Object.fromEntries((await t.rpc(FIREBASE, 'tools/list', {}, headers)).data.result.tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(tools)).toHaveLength(44);
    expect(tools.get_finance_configuration.annotations.readOnlyHint).toBe(true);
    expect(tools.apply_review.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.apply_review.inputSchema.additionalProperties).toBe(false);
    expect(tools.delete_movement.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
    expect(tools.create_movement.inputSchema.properties).toHaveProperty('operation_id');
    expect(tools.list_movements.inputSchema.properties).not.toHaveProperty('operation_id');
    expect(tools.update_movement.inputSchema.properties).not.toHaveProperty('operation_id');
  });

  it('offers its newest version to a client that asks for one it does not know', async () => {
    const initialized = await t.rpc(FIREBASE, 'initialize', { protocolVersion: '2030-01-01' }, { 'MCP-Protocol-Version': '2030-01-01' });
    expect(initialized.data.result.protocolVersion).toBe('2025-11-25');
    expect((await t.rpc(FIREBASE, 'ping', {}, { 'MCP-Protocol-Version': '2030-01-01' })).status).toBe(400);
  });

  it.each(['{broken', '[]', '{}', '{"jsonrpc":"1.0","id":1,"method":"ping"}'])('rejects the malformed envelope %s', async (body) => {
    const response = await t.send('/mcp', { body, headers: { Authorization: `Bearer ${FIREBASE}`, 'Content-Type': 'application/json' } });
    expect([response.status, response.data.error.code]).toEqual([400, -32600]);
  });

  it.each([[true], [false], [[]], [{ nested: 1 }]])('rejects the request id %o', async (id) => {
    const response = await t.send('/mcp', { json: { jsonrpc: '2.0', id, method: 'ping' }, headers: { Authorization: `Bearer ${FIREBASE}` } });
    expect([response.status, response.data.error.code]).toEqual([400, -32600]);
  });

  it('rejects invalid params and methods it does not serve', async () => {
    const invalid = await t.send('/mcp', { json: { jsonrpc: '2.0', method: 'ping', id: 2, params: [] }, headers: { Authorization: `Bearer ${FIREBASE}` } });
    expect([invalid.status, invalid.data.error.code]).toEqual([400, -32602]);
    for (const method of ['GET', 'DELETE']) expect((await t.send('/mcp', { method, headers: { Authorization: `Bearer ${FIREBASE}` } })).status).toBe(405);
    expect((await t.rpc(FIREBASE, 'resources/list')).data.error.code).toBe(-32601);
    expect((await t.tool(FIREBASE, 'delete_everything')).content[0].text).toMatch(/^unknown_tool:/);
    expect((await t.send('/nowhere', { method: 'GET' })).status).toBe(404);
    expect((await t.send('/health', { method: 'GET' })).data.status).toBe('ok');
  });

  it('refuses oversized requests', async () => {
    const response = await t.send('/mcp', { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70_000) } }),
      headers: { Authorization: `Bearer ${FIREBASE}`, 'Content-Type': 'application/json' } });
    expect(response.status).toBe(413);
  });
});

describe('tool contracts', () => {
  it.each([
    ['get_finance_configuration', { owner_id: 'other' }], ['get_movement_context', { movement_id: 12 }], ['get_movement_context', {}],
    ['list_pending_reviews', { limit: true }], ['list_pending_reviews', { limit: 51 }],
    ['apply_review', { movement_id: 'm', proposal: { expected_version: 'v', configuration_revision: 0, operation_id: 'op', reason: 'r', amount: 10 } }],
    ['apply_review', { movement_id: 'm', proposal: { expected_version: 'v', configuration_revision: '0', operation_id: 'op', reason: 'r' } }],
    ['apply_review', { movement_id: 'm', proposal: { expected_version: 'v', configuration_revision: 0, operation_id: 'op', reason: 'r', evidence: ['raw email'] } }],
    ['apply_review', { movement_id: 'm', proposal: { expected_version: 'v', configuration_revision: 0, operation_id: 'op', reason: 'r', new_subscription: { name: 'sub' } } }],
    ['get_finance_configuration', []],
    ['create_movement', { tipo: 'gasto', concepto: 'Café', importe: 0, fecha_operacion: '2026-10-10' }],
    ['create_movement', { tipo: 'transferencia', concepto: 'Café', importe: 1, fecha_operacion: '2026-10-10' }],
    ['create_movement', { tipo: 'gasto', concepto: 'Café', importe: 1, fecha_operacion: '2026-10-10', saldo_acumulado: 9 }],
    ['transfer_between_huchas', { from_hucha_id: 'main', to_hucha_id: 'food', importe: '10' }],
    ['update_hucha', { hucha_id: 'main' }], ['update_hucha', { hucha_id: 'main', saldo_acumulado: 100 }],
    ['create_subscription', { nombre: 'Gym', importe: 10, dia_pago: 32 }], ['create_subscription', { nombre: 'Gym', importe: 10, dia_pago: 2, fecha_inicio: '10/10/2026' }],
    ['convert_movement', { movement_id: 'm', distribution: [{ hucha_id: 'main' }] }], ['list_movements', { limit: 500 }],
    ['update_movement', { movement_id: 'm', name: 'Manual', importe: 1 }], ['update_movement', { movement_id: 'm', name: 'Manual', operation_id: 'x' }],
    ['record_question', { question_id: 'q', movement_ids: ['m', 'm'], question: '¿?' }],
  ])('rejects %s with arguments outside its contract', async (name, args) => {
    const before = t.db.snapshotAll();
    const result = await t.tool(FIREBASE, name, args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^invalid_arguments:/);
    expect(t.db.snapshotAll()).toEqual(before);
  });

  it('runs a review end to end through the tools', async () => {
    const context = (await t.tool(FIREBASE, 'get_movement_context', { movement_id: 'm' })).structuredContent;
    expect(context.version).toBe(proposal.expected_version);
    const pending = (await t.tool(FIREBASE, 'list_pending_reviews', { limit: 5 })).structuredContent;
    expect(pending.items.map((i) => i.movement_id)).toEqual(['m']);
    const preview = (await t.tool(FIREBASE, 'preview_review', { movement_id: 'm', proposal })).structuredContent;
    expect(preview.hucha_deltas).toEqual({ main: 1200, food: -1200 });
    const applied = await t.tool(FIREBASE, 'apply_review', { movement_id: 'm', proposal });
    expect(applied.isError).toBe(false);
    expect(t.db.read('movimientos', 'm')).toMatchObject({ concepto: 'Compra semanal', categoria: 'alimentacion', hucha_id: 'food' });
    expect([t.db.read('huchas', 'main').saldo_acumulado, t.db.read('huchas', 'food').saldo_acumulado]).toEqual([112, 38]);
    const reverted = await t.tool(FIREBASE, 'revert_review', { review_id: applied.structuredContent.review_id });
    expect(reverted.structuredContent).toEqual({ review_id: applied.structuredContent.review_id, reverted: true });
    expect([t.db.read('huchas', 'main').saldo_acumulado, t.db.read('huchas', 'food').saldo_acumulado]).toEqual([100, 50]);
  });

  it('reports switched-off review writes as an actionable tool error', async () => {
    t.env.FLOWT_REVIEW_WRITES_ENABLED = 'false';
    const response = await t.rpc(FIREBASE, 'tools/call', { name: 'apply_review', arguments: { movement_id: 'm', proposal } });
    expect(response.status).toBe(200);
    expect(response.data.result.isError).toBe(true);
    expect(response.data.result.content[0].text).toMatch(/^writes_disabled:/);
  });

  it('lets an assistant with write access edit a movement as the user', async () => {
    const { tokens: reader } = await t.connect({ write: false });
    const { tokens: writer } = await t.connect();
    const args = { movement_id: 'm', name: 'Manual', category: 'alimentacion' };
    expect((await t.tool(writer.access_token, 'edit_movement', args)).content[0].text).toMatch(/^unknown_tool:/);
    expect((await t.tool(reader.access_token, 'update_movement', args)).content[0].text).toMatch(/^insufficient_scope:/);
    expect(t.db.read('movimientos', 'm').concepto).toBe('Bank charge');
    expect((await t.tool(writer.access_token, 'update_movement', args)).isError).toBe(false);
    expect(t.db.read('movimientos', 'm')).toMatchObject({ concepto: 'Manual', categoria: 'alimentacion', hucha_id: 'food' });
    expect(t.db.read('movimientos', 'm').field_provenance.concepto.source).toBe('manual');
  });

  it('never echoes internal failures', async () => {
    const secret = 'private firebase credential and account details';
    t.db.query = async () => { throw new Error(secret); };
    const response = await t.rpc(FIREBASE, 'tools/call', { name: 'list_huchas', arguments: {} });
    expect(response.data.result.isError).toBe(true);
    expect(response.data.result.content[0].text).toContain('retryable_error');
    expect(response.text).not.toContain(secret);
    const api = await web('/api/reviews/history', { limit: 10 });
    expect([api.status, api.data.error]).toEqual([503, 'retryable_error']);
    expect(api.text).not.toContain(secret);
  });

  it('limits how fast one user can call tools', async () => {
    let last;
    for (let call = 0; call <= RATE_LIMITS.perUserToolCallsPerMinute; call += 1) last = await t.rpc(FIREBASE, 'tools/call', { name: 'list_categories', arguments: {} });
    expect(last.status).toBe(429);
    expect(last.headers.get('Retry-After')).toBeTruthy();
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    expect((await t.rpc(FIREBASE, 'tools/call', { name: 'list_categories', arguments: {} })).status).toBe(200);
  });
});

describe('web review API', () => {
  it('serves history and revert with the same contracts as the tools', async () => {
    const applied = (await t.tool(FIREBASE, 'apply_review', { movement_id: 'm', proposal })).structuredContent;
    const history = await web('/api/reviews/history', { limit: 10 });
    expect(history.data.items.map((i) => i.id)).toEqual([applied.review_id]);
    expect(history.data.next_cursor).toBeNull();
    expect((await web('/api/reviews/questions', {})).data).toEqual({ items: [], errors: [] });
    const invalid = await web('/api/reviews/revert', { review_id: applied.review_id, owner_id: 'other' });
    expect([invalid.status, invalid.data.error]).toEqual([409, 'invalid_arguments']);
    expect((await web('/api/reviews/revert', { review_id: applied.review_id })).data.reverted).toBe(true);
    expect((await web('/api/reviews/missing', {})).status).toBe(404);
  });

  it('edits a movement for the signed-in user only', async () => {
    const args = { movement_id: 'm', name: 'Manual', category: 'alimentacion', hucha_id: 'food' };
    const edited = await web('/api/reviews/edit', args);
    expect([edited.status, edited.data.changes.categoria]).toEqual([200, 'alimentacion']);
    expect(t.db.read('movimientos', 'm')).toMatchObject({ concepto: 'Manual', hucha_id: 'food' });
    expect((await web('/api/reviews/edit', args, { ...WEB, Authorization: 'Bearer firebase-other' })).status).toBe(409);
  });

  it('does not accept the fixed review token or an assistant token for manual edits', async () => {
    t = setup({ FLOWT_MCP_TOKEN: 'p'.repeat(40), FLOWT_MCP_OWNER_UID: 'owner' });
    t.db.put('movimientos', 'm', { id_propietario: 'owner', tipo: 'gasto', concepto: 'Bank charge', importe: 12, hucha_id: 'main' });
    const { tokens } = await t.connect();
    for (const token of ['p'.repeat(40), tokens.access_token]) {
      const denied = await t.send('/api/reviews/edit', { json: { movement_id: 'm', name: 'Manual' }, headers: { Authorization: `Bearer ${token}` } });
      expect([denied.status, denied.data.error]).toEqual([401, 'unauthorized']);
    }
    expect(t.db.read('movimientos', 'm').concepto).toBe('Bank charge');
    expect((await t.tool('p'.repeat(40), 'get_finance_configuration')).isError).toBe(false);
  });

  it.each(['saldo_acumulado', 'amount', 'importe', 'tipo', 'owner_id', 'id_propietario', 'subscription_id'])(
    'forbids the manual edit from setting %s', async (field) => {
      const response = await web('/api/reviews/edit', { movement_id: 'm', name: 'Manual', [field]: 20 });
      expect([response.status, response.data.error]).toEqual([409, 'invalid_arguments']);
      expect(t.db.read('movimientos', 'm').concepto).toBe('Bank charge');
    });

  it.each([[{}], [{ movement_id: 'm' }], [{ movement_id: 'm', name: '' }], [{ movement_id: true, name: 'Manual' }]])(
    'rejects the empty or invalid edit %o', async (args) => {
      const response = await web('/api/reviews/edit', args);
      expect([response.status, response.data.error]).toEqual([409, 'invalid_arguments']);
    });
});

describe('addresses', () => {
  it('announces the address it is reached at, or the configured public one', async () => {
    expect((await t.send('/.well-known/oauth-protected-resource', { method: 'GET' })).data.resource).toBe(`${BASE}/mcp`);
    t.env.PUBLIC_ORIGIN = 'https://conector.flowt.example/';
    const metadata = (await t.send('/.well-known/oauth-authorization-server', { method: 'GET' })).data;
    expect(metadata.issuer).toBe('https://conector.flowt.example');
    expect(metadata.token_endpoint).toBe('https://conector.flowt.example/oauth/token');
  });
});
