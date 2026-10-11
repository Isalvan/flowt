"""Exercise the authenticated HTTP transport without contacting Firebase."""
import json
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mcp_server import Principal, authenticate, create_app
from reviews.domain import ReviewError


HEADERS = {'Authorization': 'Bearer valid', 'MCP-Protocol-Version': '2025-11-25'}
PROPOSAL = {'expected_version': '2026-10-04T01:00:00Z', 'configuration_revision': 0, 'operation_id': 'op', 'reason': 'Recibo del pedido'}


@pytest.fixture
def transport(monkeypatch):
    monkeypatch.delenv('FLOWT_REVIEW_ALLOWED_ORIGINS', raising=False)
    service = Mock()
    service.get_finance_configuration.return_value = {'categories': []}
    service.get_movement_context.return_value = {'movement': {'id': 'm'}, 'version': 'v'}
    service.apply_review.return_value = {'review_id': 'r', 'state': 'reviewed'}
    service.get_review_history.return_value = {'items': [], 'next_cursor': None}
    service.revert_review.return_value = {'review_id': 'r', 'reverted': True}
    service.edit_movement.return_value = {'movement_id': 'm', 'changes': {'concepto': 'Mi descripción'}}

    def verifier(header):
        if header != 'Bearer valid':
            raise ReviewError('unauthorized', 'Credenciales no válidas')
        return 'authenticated-owner'

    app = create_app(service, verifier)
    app.config['TESTING'] = True
    return app.test_client(), service


def rpc(client, method, params=None, **kwargs):
    return client.post('/mcp', json={'jsonrpc': '2.0', 'id': 7, 'method': method, 'params': params or {}}, headers=kwargs.pop('headers', HEADERS), **kwargs)


def call(client, name, arguments=None, **kwargs):
    return rpc(client, 'tools/call', {'name': name, 'arguments': {} if arguments is None else arguments}, **kwargs)


@pytest.mark.parametrize('name,args', [('get_finance_configuration', {}), ('apply_review', {'movement_id': 'm', 'proposal': PROPOSAL}), ('revert_review', {'review_id': 'r'})])
def test_read_and_write_require_authentication(transport, name, args):
    client, service = transport
    response = call(client, name, args, headers={})
    assert response.status_code == 401
    assert response.json == {'error': 'unauthorized'}
    assert not service.mock_calls


@pytest.mark.parametrize('action,args', [('history', {}), ('revert', {'review_id': 'r'})])
def test_web_api_requires_authentication(transport, action, args):
    client, service = transport
    assert client.post('/api/reviews/' + action, json=args).status_code == 401
    assert not service.mock_calls


def test_allowed_origin_and_preflight(transport, monkeypatch):
    client, service = transport
    headers = {**HEADERS, 'Origin': 'https://flowt.example'}
    assert call(client, 'get_finance_configuration', headers=headers).status_code == 403
    assert client.options('/mcp', headers=headers).status_code == 403
    assert not service.mock_calls
    monkeypatch.setenv('FLOWT_REVIEW_ALLOWED_ORIGINS', 'https://other.example, https://flowt.example')
    response = client.options('/api/reviews/history', headers={'Origin': 'https://flowt.example'})
    assert response.status_code == 204
    assert response.headers['Access-Control-Allow-Origin'] == 'https://flowt.example'
    assert 'Authorization' in response.headers['Access-Control-Allow-Headers']
    assert call(client, 'get_finance_configuration', headers=headers).status_code == 200


@pytest.mark.parametrize('protocol', ['2025-03-26', '2025-06-18', '2025-11-25'])
def test_initialize_notify_ping_and_tool_discovery(transport, protocol):
    client, _ = transport
    initialized = rpc(client, 'initialize', {'protocolVersion': protocol, 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}})
    assert initialized.status_code == 200
    assert initialized.json['result']['protocolVersion'] == protocol
    assert initialized.json['result']['capabilities']['tools'] == {'listChanged': False}
    notified = client.post('/mcp', json={'jsonrpc': '2.0', 'method': 'notifications/initialized'}, headers=HEADERS)
    assert notified.status_code == 202
    assert notified.data == b''
    assert rpc(client, 'ping').json['result'] == {}
    tools = rpc(client, 'tools/list').json['result']['tools']
    by_name = {tool['name']: tool for tool in tools}
    assert by_name['get_finance_configuration']['annotations']['readOnlyHint'] is True
    assert by_name['apply_review']['annotations']['readOnlyHint'] is False
    assert by_name['apply_review']['inputSchema']['additionalProperties'] is False


def test_owner_is_derived_from_verified_credentials(transport):
    client, service = transport
    response = call(client, 'get_movement_context', {'movement_id': 'm'})
    service.get_movement_context.assert_called_once_with('authenticated-owner', movement_id='m')
    assert response.json['result']['isError'] is False
    assert json.loads(response.json['result']['content'][0]['text']) == response.json['result']['structuredContent']
    response = call(client, 'apply_review', {'movement_id': 'm', 'proposal': PROPOSAL})
    service.apply_review.assert_called_once_with('authenticated-owner', movement_id='m', proposal=PROPOSAL)
    assert response.json['result']['structuredContent']['review_id'] == 'r'
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.headers['X-Content-Type-Options'] == 'nosniff'


@pytest.mark.parametrize('name,args', [
    ('get_finance_configuration', {'owner_id': 'other'}),
    ('get_movement_context', {'movement_id': 12}),
    ('get_movement_context', {}),
    ('list_pending_reviews', {'limit': True}),
    ('list_pending_reviews', {'limit': 51}),
    ('apply_review', {'movement_id': 'm', 'proposal': {**PROPOSAL, 'amount': 10}}),
    ('apply_review', {'movement_id': 'm', 'proposal': {**PROPOSAL, 'configuration_revision': '0'}}),
    ('apply_review', {'movement_id': 'm', 'proposal': {**PROPOSAL, 'evidence': ['raw email']}}),
    ('apply_review', {'movement_id': 'm', 'proposal': {**PROPOSAL, 'new_subscription': {'name': 'sub'}}}),
    ('get_finance_configuration', []),
])
def test_tool_schema_rejects_extra_fields_and_wrong_types(transport, name, args):
    client, service = transport
    result = call(client, name, args).json['result']
    assert result['isError'] is True
    assert result['content'][0]['text'].startswith('invalid_arguments:')
    assert not service.mock_calls


def test_unknown_tool_and_unknown_rpc_method(transport):
    client, service = transport
    assert call(client, 'delete_everything').json['result']['content'][0]['text'].startswith('unknown_tool:')
    assert rpc(client, 'resources/list').json['error']['code'] == -32601
    assert not service.mock_calls


def test_disabled_writes_are_an_actionable_tool_error(transport):
    client, service = transport
    service.apply_review.side_effect = ReviewError('writes_disabled', 'Las escrituras están desactivadas')
    response = call(client, 'apply_review', {'movement_id': 'm', 'proposal': PROPOSAL})
    assert response.status_code == 200
    assert response.json['result']['isError'] is True
    assert response.json['result']['content'][0]['text'].startswith('writes_disabled:')


def test_web_history_and_revert_contracts(transport):
    client, service = transport
    history = client.post('/api/reviews/history', json={'limit': 10}, headers=HEADERS)
    assert history.json == {'items': [], 'next_cursor': None}
    service.get_review_history.assert_called_once_with('authenticated-owner', limit=10)
    reverted = client.post('/api/reviews/revert', json={'review_id': 'r'}, headers=HEADERS)
    assert reverted.json['reverted'] is True
    service.revert_review.assert_called_once_with('authenticated-owner', review_id='r')
    invalid = client.post('/api/reviews/revert', json={'review_id': 'r', 'owner_id': 'other'}, headers=HEADERS)
    assert invalid.status_code == 409
    assert invalid.json['error'] == 'invalid_arguments'
    assert client.post('/api/reviews/missing', json={}, headers=HEADERS).status_code == 404


@pytest.mark.parametrize('payload', ['{broken', '[]', '{}', '{"jsonrpc":"1.0","id":1,"method":"ping"}'])
def test_malformed_json_and_rpc_envelope(transport, payload):
    client, service = transport
    response = client.post('/mcp', data=payload, content_type='application/json', headers=HEADERS)
    assert response.status_code == 400
    assert response.json['error']['code'] == -32600
    assert not service.mock_calls


def test_invalid_params_protocol_and_unsupported_methods(transport):
    client, _ = transport
    response = client.post('/mcp', json={'jsonrpc': '2.0', 'method': 'ping', 'id': 2, 'params': []}, headers=HEADERS)
    assert response.status_code == 400
    assert response.json['error']['code'] == -32602
    assert rpc(client, 'ping', headers={**HEADERS, 'MCP-Protocol-Version': 'unknown'}).status_code == 400
    assert client.get('/mcp', headers=HEADERS).status_code == 405
    assert client.delete('/mcp', headers=HEADERS).status_code == 405


@pytest.mark.parametrize('invalid_id', [True, False, [], {'nested': 1}])
def test_json_rpc_rejects_invalid_identifier_types(transport, invalid_id):
    client, service = transport
    response = client.post('/mcp', json={'jsonrpc': '2.0', 'id': invalid_id, 'method': 'ping'}, headers=HEADERS)
    assert response.status_code == 400
    assert response.json['error']['code'] == -32600
    assert not service.mock_calls


def test_private_service_exceptions_are_sanitized(transport):
    client, service = transport
    secret = 'private firebase credential and account details'
    service.apply_review.side_effect = RuntimeError(secret)
    response = call(client, 'apply_review', {'movement_id': 'm', 'proposal': PROPOSAL})
    assert response.json['result']['isError'] is True
    assert 'retryable_error' in response.json['result']['content'][0]['text']
    assert secret not in response.get_data(as_text=True)
    service.revert_review.side_effect = RuntimeError(secret)
    response = client.post('/api/reviews/revert', json={'review_id': 'r'}, headers=HEADERS)
    assert response.status_code == 503
    assert response.json['error'] == 'retryable_error'
    assert secret not in response.get_data(as_text=True)


def test_pilot_authentication_is_owner_scoped(monkeypatch):
    token = 'p' * 32
    monkeypatch.setenv('FLOWT_MCP_TOKEN', token)
    monkeypatch.setenv('FLOWT_MCP_OWNER_UID', 'pilot-owner')
    verify = Mock()
    monkeypatch.setattr('mcp_server.auth.verify_id_token', verify)
    pilot = authenticate('Bearer ' + token)
    assert pilot.uid == 'pilot-owner' and pilot.scopes == {'flowt:review'}
    verify.assert_not_called()
    verify.return_value = {'uid': 'firebase-owner'}
    web = authenticate('Bearer firebase-token')
    assert web.uid == 'firebase-owner' and {'flowt:read', 'flowt:write'} <= web.scopes
    verify.assert_called_once_with('firebase-token', check_revoked=True)


def test_invalid_credentials_do_not_expose_verifier_exception(monkeypatch):
    monkeypatch.delenv('FLOWT_MCP_TOKEN', raising=False)
    monkeypatch.setattr('mcp_server.auth.verify_id_token', Mock(side_effect=RuntimeError('private key details')))
    with pytest.raises(ReviewError) as error:
        authenticate('Bearer invalid')
    assert error.value.code == 'unauthorized'
    assert 'private' not in str(error.value)


def test_pilot_mcp_token_cannot_access_manual_edit_api(monkeypatch):
    token = 'local-pilot-test-token-' + 'p' * 32
    monkeypatch.setenv('FLOWT_MCP_TOKEN', token)
    monkeypatch.setenv('FLOWT_MCP_OWNER_UID', 'pilot-owner')
    firebase_verifier = Mock(side_effect=RuntimeError('Not a Firebase token'))
    monkeypatch.setattr('mcp_server.auth.verify_id_token', firebase_verifier)
    service = Mock()
    service.get_finance_configuration.return_value = {'categories': []}
    client = create_app(service).test_client()
    headers = {'Authorization': 'Bearer ' + token}
    assert call(client, 'get_finance_configuration', headers=headers).json['result']['isError'] is False
    service.get_finance_configuration.assert_called_once_with('pilot-owner')
    firebase_verifier.assert_not_called()
    denied = client.post('/api/reviews/edit', json={'movement_id': 'm', 'name': 'Manual'}, headers=headers)
    assert denied.status_code == 401
    assert denied.json['error'] == 'unauthorized'
    firebase_verifier.assert_called_once_with(token, check_revoked=True)
    service.edit_movement.assert_not_called()


def test_firebase_authenticated_manual_edit_uses_verified_owner(monkeypatch):
    monkeypatch.setattr('mcp_server.auth.verify_id_token', Mock(return_value={'uid': 'firebase-owner'}))
    service = Mock()
    service.edit_movement.return_value = {'movement_id': 'm', 'changes': {'categoria': 'compras'}}
    client = create_app(service).test_client()
    args = {'movement_id': 'm', 'name': 'Manual', 'category': 'compras', 'hucha_id': 'wallet'}
    response = client.post('/api/reviews/edit', json=args, headers={'Authorization': 'Bearer firebase-token'})
    assert response.status_code == 200
    service.edit_movement.assert_called_once_with('firebase-owner', **args)
    assert response.json['changes']['categoria'] == 'compras'


@pytest.mark.parametrize('extra_field', ['saldo_acumulado', 'amount', 'importe', 'tipo', 'owner_id', 'id_propietario', 'subscription_id'])
def test_manual_edit_api_forbids_financial_and_owner_overrides(transport, extra_field):
    client, service = transport
    response = client.post('/api/reviews/edit', json={'movement_id': 'm', 'name': 'Manual', extra_field: 20}, headers=HEADERS)
    assert response.status_code == 409
    assert response.json['error'] == 'invalid_arguments'
    service.edit_movement.assert_not_called()


@pytest.mark.parametrize('arguments', [{}, {'movement_id': 'm'}, {'movement_id': 'm', 'name': ''}, {'movement_id': True, 'name': 'Manual'}])
def test_manual_edit_api_rejects_empty_or_invalid_edits(transport, arguments):
    client, service = transport
    response = client.post('/api/reviews/edit', json=arguments, headers=HEADERS)
    assert response.status_code == 409
    assert response.json['error'] == 'invalid_arguments'
    service.edit_movement.assert_not_called()


def test_manual_edits_reach_mcp_only_as_update_movement_with_write_access(monkeypatch):
    service, finance = Mock(), Mock()
    finance.update_movement.return_value = {'movement_id': 'm', 'changes': {'concepto': 'Manual'}}
    scopes = {'Bearer reader': {'flowt:read'}, 'Bearer writer': {'flowt:read', 'flowt:write'}}
    client = create_app(service, lambda header: Principal('owner', frozenset(scopes[header])), finance).test_client()
    arguments = {'movement_id': 'm', 'name': 'Manual'}
    # The service's internal operation is never a tool of its own.
    unknown = call(client, 'edit_movement', arguments, headers={'Authorization': 'Bearer writer'})
    assert unknown.json['result']['content'][0]['text'].startswith('unknown_tool:')
    denied = call(client, 'update_movement', arguments, headers={'Authorization': 'Bearer reader'})
    assert denied.json['result']['content'][0]['text'].startswith('insufficient_scope:')
    finance.update_movement.assert_not_called()
    allowed = call(client, 'update_movement', arguments, headers={'Authorization': 'Bearer writer'})
    assert allowed.json['result']['isError'] is False
    finance.update_movement.assert_called_once_with('owner', **arguments)
    for extra in ['importe', 'tipo', 'owner_id', 'operation_id']:
        rejected = call(client, 'update_movement', {**arguments, extra: 1}, headers={'Authorization': 'Bearer writer'})
        assert rejected.json['result']['content'][0]['text'].startswith('invalid_arguments:')
    service.edit_movement.assert_not_called()


@pytest.mark.parametrize('name,arguments', [
    ('create_movement', {'tipo': 'gasto', 'concepto': 'Café', 'importe': 0, 'fecha_operacion': '2026-10-10'}),
    ('create_movement', {'tipo': 'transferencia', 'concepto': 'Café', 'importe': 1, 'fecha_operacion': '2026-10-10'}),
    ('create_movement', {'tipo': 'gasto', 'concepto': 'Café', 'importe': 1, 'fecha_operacion': '2026-10-10', 'saldo_acumulado': 9}),
    ('transfer_between_huchas', {'from_hucha_id': 'a', 'to_hucha_id': 'b', 'importe': '10'}),
    ('update_hucha', {'hucha_id': 'a'}),
    ('update_hucha', {'hucha_id': 'a', 'saldo_acumulado': 100}),
    ('create_subscription', {'nombre': 'Gym', 'importe': 10, 'dia_pago': 32}),
    ('convert_movement', {'movement_id': 'm', 'distribution': [{'hucha_id': 'a'}]}),
    ('list_movements', {'limit': 500}),
])
def test_finance_tools_reject_arguments_outside_their_contract(name, arguments):
    finance = Mock()
    client = create_app(Mock(), lambda header: 'owner', finance).test_client()
    result = call(client, name, arguments).json['result']
    assert result['isError'] is True and result['content'][0]['text'].startswith('invalid_arguments:')
    assert not finance.mock_calls


def test_finance_tools_pass_only_the_published_arguments_to_the_verified_owner():
    finance = Mock()
    finance.create_movement.return_value = {'movement': {'id': 'm'}}
    client = create_app(Mock(), lambda header: 'owner', finance).test_client()
    arguments = {'tipo': 'gasto', 'concepto': 'Café', 'importe': 2.5, 'fecha_operacion': '2026-10-10', 'operation_id': 'op-1'}
    assert call(client, 'create_movement', arguments).json['result']['structuredContent'] == {'movement': {'id': 'm'}}
    finance.create_movement.assert_called_once_with('owner', **arguments)
    tools = {tool['name']: tool for tool in rpc(client, 'tools/list').json['result']['tools']}
    assert tools['delete_movement']['annotations'] == {'readOnlyHint': False, 'destructiveHint': True, 'idempotentHint': False, 'openWorldHint': False}
    assert tools['list_movements']['annotations']['readOnlyHint'] is True
    assert 'operation_id' in tools['create_movement']['inputSchema']['properties']
    assert 'operation_id' not in tools['list_movements']['inputSchema']['properties']
