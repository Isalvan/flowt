"""The OAuth flow an MCP client follows, over real HTTP routes and an in-memory Firestore."""
import base64
import hashlib
import sys
from datetime import timedelta
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from finance.service import FinanceService
from mcp_auth import AuthorizationServer, Settings, now, same_redirect, valid_redirect
from mcp_server import create_app
from .memory_firestore import MemoryFirestore

BASE = "https://flowt.example"
WEB = {"Authorization": "Bearer firebase-owner", "Origin": BASE}
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


@pytest.fixture
def flow(monkeypatch):
    monkeypatch.setenv("FLOWT_REVIEW_ALLOWED_ORIGINS", BASE)
    monkeypatch.delenv("FLOWT_MCP_TOKEN", raising=False)
    monkeypatch.delenv("FLOWT_MCP_WRITES_ENABLED", raising=False)

    def firebase(token, check_revoked=False):
        if not token.startswith("firebase-"):
            raise ValueError("not a Firebase token")
        return {"uid": token.removeprefix("firebase-")}
    monkeypatch.setattr("mcp_server.auth.verify_id_token", firebase)
    db = MemoryFirestore()
    db.put("huchas", "main", {"id_propietario": "owner", "nombre": "Cuenta", "tipo_aportacion": "resto", "es_principal": True,
                              "saldo_acumulado": 100, "orden": 1})
    server = AuthorizationServer(db, Settings(BASE, BASE + "/conectar"))
    finance = FinanceService(db)
    server._atomic = finance._atomic = finance.reviews._atomic = db.atomic
    app = create_app(service=finance.reviews, finance=finance, oauth=server)
    app.config["TESTING"] = True
    return app.test_client(), db


def register(client, **metadata):
    return client.post("/oauth/register", json={"client_name": "Claude", "redirect_uris": [CALLBACK], **metadata})


def request_params(client_id, **overrides):
    return {"response_type": "code", "client_id": client_id, "redirect_uri": CALLBACK, "state": "xyz", "code_challenge": CHALLENGE,
            "code_challenge_method": "S256", "scope": "flowt:read flowt:write", "resource": BASE + "/mcp", **overrides}


def authorize(client, client_id, write=True, headers=WEB, **overrides):
    response = client.post("/oauth/authorize/decision", headers=headers,
                           json={"params": request_params(client_id, **overrides), "approve": True, "write": write})
    assert response.status_code == 200, response.json
    return parse_qs(urlsplit(response.json["redirect_to"]).query)["code"][0]


def exchange(client, client_id, code, **overrides):
    return client.post("/oauth/token", data={"grant_type": "authorization_code", "client_id": client_id, "code": code,
                                              "code_verifier": VERIFIER, "redirect_uri": CALLBACK, **overrides})


def connect(client, write=True, **metadata):
    client_id = register(client, **metadata).json["client_id"]
    tokens = exchange(client, client_id, authorize(client, client_id, write)).json
    return client_id, tokens


def mcp(client, token, method="tools/list", params=None):
    return client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
                       headers={"Authorization": f"Bearer {token}", "MCP-Protocol-Version": "2025-11-25"})


def call(client, token, name, arguments=None):
    return mcp(client, token, "tools/call", {"name": name, "arguments": arguments or {}}).json["result"]


def test_a_client_discovers_registers_gets_consent_and_calls_tools(flow):
    client, db = flow
    challenge = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert challenge.status_code == 401
    assert f'resource_metadata="{BASE}/.well-known/oauth-protected-resource/mcp"' in challenge.headers["WWW-Authenticate"]
    resource = client.get("/.well-known/oauth-protected-resource/mcp").json
    assert resource["resource"] == BASE + "/mcp" and resource["authorization_servers"] == [BASE]
    metadata = client.get("/.well-known/oauth-authorization-server").json
    assert metadata["issuer"] == BASE and metadata["authorization_endpoint"] == BASE + "/conectar"
    assert metadata["code_challenge_methods_supported"] == ["S256"] and metadata["registration_endpoint"] == BASE + "/oauth/register"

    registered = register(client)
    assert registered.status_code == 201 and "client_secret" not in registered.json
    client_id = registered.json["client_id"]
    preview = client.post("/oauth/authorize/preview", headers=WEB, json={"params": request_params(client_id)})
    assert preview.json == {"client_name": "Claude", "scopes": ["flowt:read", "flowt:write"], "redirect_host": "claude.ai", "local": False}

    decision = client.post("/oauth/authorize/decision", headers=WEB, json={"params": request_params(client_id), "approve": True})
    back = urlsplit(decision.json["redirect_to"])
    query = parse_qs(back.query)
    assert f"{back.scheme}://{back.netloc}{back.path}" == CALLBACK and query["state"] == ["xyz"] and query["iss"] == [BASE]
    tokens = exchange(client, client_id, query["code"][0])
    assert tokens.status_code == 200 and tokens.headers["Cache-Control"] == "no-store"
    assert tokens.json["token_type"] == "Bearer" and tokens.json["scope"] == "flowt:read flowt:write" and tokens.json["expires_in"] == 3600

    access = tokens.json["access_token"]
    names = {t["name"] for t in mcp(client, access).json["result"]["tools"]}
    assert {"get_overview", "create_movement", "delete_movement", "apply_review"} <= names
    overview = call(client, access, "get_overview")
    assert overview["isError"] is False and overview["structuredContent"]["total_balance"] == 100
    created = call(client, access, "create_movement", {"tipo": "gasto", "concepto": "Café", "importe": 2.5, "fecha_operacion": "2026-10-10"})
    assert created["isError"] is False and db.doc("huchas", "main")["saldo_acumulado"] == 97.5
    # Nothing readable is stored: only digests of the secrets handed to the client.
    stored = str(db.data)
    assert access not in stored and tokens.json["refresh_token"] not in stored and query["code"][0] not in stored


def test_a_code_works_once_and_a_replay_ends_the_connection(flow):
    client, _ = flow
    client_id = register(client).json["client_id"]
    code = authorize(client, client_id)
    access = exchange(client, client_id, code).json["access_token"]
    assert mcp(client, access).status_code == 200
    replay = exchange(client, client_id, code)
    assert replay.status_code == 400 and replay.json["error"] == "invalid_grant"
    assert mcp(client, access).status_code == 401


@pytest.mark.parametrize("overrides", [
    {"code_verifier": "w" * 64},
    {"code_verifier": "short"},
    {"redirect_uri": "https://claude.ai/other"},
    {"code": "flowt_ac_unknown"},
    {"resource": "https://elsewhere.example/mcp"},
])
def test_token_exchange_rejects_anything_that_does_not_match_the_consent(flow, overrides):
    client, db = flow
    client_id = register(client).json["client_id"]
    code = authorize(client, client_id)
    response = exchange(client, client_id, **{"code": code, **overrides})
    assert response.status_code == 400 and response.json["error"] in {"invalid_grant", "invalid_target"}
    assert not db.docs("oauth_tokens")


def test_codes_expire_and_belong_to_the_client_that_asked(flow):
    client, db = flow
    client_id, other_id = register(client).json["client_id"], register(client).json["client_id"]
    assert exchange(client, other_id, authorize(client, client_id)).json["error"] == "invalid_grant"
    code = authorize(client, client_id)
    for data in db.docs("oauth_codes").values():
        data["expires_at"] = now() - timedelta(seconds=1)
    assert exchange(client, client_id, code).json["error"] == "invalid_grant"
    assert exchange(client, "flowt-unknown", code).status_code == 401


def test_read_only_consent_cannot_change_anything(flow):
    client, db = flow
    _, tokens = connect(client, write=False)
    assert tokens["scope"] == "flowt:read"
    names = {t["name"] for t in mcp(client, tokens["access_token"]).json["result"]["tools"]}
    assert "list_movements" in names and "list_pending_reviews" in names
    assert not names & {"create_movement", "delete_movement", "apply_review", "update_movement", "archive_hucha"}
    for name, arguments in [("create_movement", {"tipo": "gasto", "concepto": "Café", "importe": 2, "fecha_operacion": "2026-10-10"}),
                            ("revert_review", {"review_id": "r"})]:
        result = call(client, tokens["access_token"], name, arguments)
        assert result["isError"] is True and result["content"][0]["text"].startswith("insufficient_scope:")
    assert db.doc("huchas", "main")["saldo_acumulado"] == 100


def test_each_user_only_reaches_their_own_data(flow):
    client, db = flow
    db.put("huchas", "theirs", {"id_propietario": "other", "nombre": "Ajena", "tipo_aportacion": "resto", "saldo_acumulado": 7, "orden": 1})
    client_id = register(client).json["client_id"]
    other = exchange(client, client_id, authorize(client, client_id, headers={**WEB, "Authorization": "Bearer firebase-other"})).json
    wallets = call(client, other["access_token"], "list_huchas")["structuredContent"]["items"]
    assert [w["id"] for w in wallets] == ["theirs"]
    # The owner is the signed-in user of the consent screen; a tool argument cannot change it.
    assert call(client, other["access_token"], "list_huchas", {"owner": "owner"})["isError"] is True


def test_refresh_rotates_tolerates_a_retry_and_detects_a_stolen_token(flow):
    client, db = flow
    client_id, tokens = connect(client)
    refresh = lambda token: client.post("/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id, "refresh_token": token})
    renewed = refresh(tokens["refresh_token"])
    assert renewed.status_code == 200 and renewed.json["refresh_token"] != tokens["refresh_token"]
    assert mcp(client, renewed.json["access_token"]).status_code == 200
    # The response was lost and the client retries with the token it still has.
    assert refresh(tokens["refresh_token"]).status_code == 200
    assert refresh("flowt_rt_unknown").json["error"] == "invalid_grant"
    for data in db.docs("oauth_tokens").values():
        if data.get("rotated_at"):
            data["rotated_at"] = now() - timedelta(minutes=5)
    assert refresh(tokens["refresh_token"]).json["error"] == "invalid_grant"
    assert mcp(client, renewed.json["access_token"]).status_code == 401
    assert refresh(renewed.json["refresh_token"]).json["error"] == "invalid_grant"
    assert not db.docs("oauth_grants")


def test_expired_access_tokens_stop_working_and_are_pruned(flow):
    client, db = flow
    client_id, tokens = connect(client)
    for data in db.docs("oauth_tokens").values():
        if data["kind"] == "access":
            data["expires_at"] = now() - timedelta(seconds=1)
    assert mcp(client, tokens["access_token"]).status_code == 401
    client.post("/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id, "refresh_token": tokens["refresh_token"]})
    assert all(data["expires_at"] > now() for data in db.docs("oauth_tokens").values())


def test_consent_requires_the_flowt_session_and_the_flowt_origin(flow):
    client, _ = flow
    client_id, tokens = connect(client)
    body = {"params": request_params(client_id), "approve": True}
    assert client.post("/oauth/authorize/decision", json=body).status_code == 401
    # A connected app cannot approve further connections with its own token.
    assert client.post("/oauth/authorize/decision", json=body, headers={"Authorization": f"Bearer {tokens['access_token']}"}).status_code == 401
    assert client.post("/oauth/authorize/decision", json=body, headers={**WEB, "Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/connections/list", json={}, headers={"Authorization": f"Bearer {tokens['access_token']}"}).status_code == 401


def test_denying_and_malformed_requests(flow):
    client, db = flow
    client_id = register(client).json["client_id"]
    denied = client.post("/oauth/authorize/decision", headers=WEB, json={"params": request_params(client_id), "approve": False})
    assert parse_qs(urlsplit(denied.json["redirect_to"]).query) == {"error": ["access_denied"], "state": ["xyz"], "iss": [BASE]}
    assert not db.docs("oauth_codes")
    # A wrong return address is never redirected to: the user just sees the error.
    for overrides in ({"redirect_uri": "https://evil.example/cb"}, {"client_id": "flowt-unknown"}):
        wrong = client.post("/oauth/authorize/preview", headers=WEB, json={"params": {**request_params(client_id), **overrides}})
        assert wrong.status_code == 400 and "redirect_to" not in wrong.json
    # Other mistakes are reported back to the registered client.
    for overrides in ({"code_challenge_method": "plain"}, {"response_type": "token"}, {"resource": "https://elsewhere.example"}):
        wrong = client.post("/oauth/authorize/preview", headers=WEB, json={"params": request_params(client_id, **overrides)})
        assert wrong.status_code == 400 and wrong.json["redirect_to"].startswith(CALLBACK + "?error=")
    assert client.post("/oauth/authorize/preview", headers=WEB, json={"params": {"client_id": 5}}).status_code == 400
    assert client.post("/oauth/authorize/decision", headers=WEB, json={"params": request_params(client_id)}).status_code == 400


def test_the_user_can_see_and_revoke_connections(flow):
    client, db = flow
    _, tokens = connect(client)
    listed = client.post("/api/connections/list", json={}, headers=WEB).json
    assert listed["mcp_url"] == BASE + "/mcp" and len(listed["items"]) == 1
    connection = listed["items"][0]
    assert connection["client_name"] == "Claude" and connection["redirect_host"] == "claude.ai" and connection["scopes"] == ["flowt:read", "flowt:write"]
    assert "id_propietario" not in connection
    stranger = {**WEB, "Authorization": "Bearer firebase-other"}
    assert client.post("/api/connections/list", json={}, headers=stranger).json["items"] == []
    assert client.post("/api/connections/revoke", json={"connection_id": connection["id"]}, headers=stranger).json == {"revoked": False}
    assert mcp(client, tokens["access_token"]).status_code == 200
    assert client.post("/api/connections/revoke", json={"connection_id": connection["id"]}, headers=WEB).json == {"revoked": True}
    assert mcp(client, tokens["access_token"]).status_code == 401
    assert not db.docs("oauth_tokens") and not db.docs("oauth_grants")


def test_a_client_can_revoke_its_own_tokens(flow):
    client, _ = flow
    client_id, tokens = connect(client)
    assert client.post("/oauth/revoke", data={"client_id": client_id, "token": "flowt_at_unknown"}).status_code == 200
    assert mcp(client, tokens["access_token"]).status_code == 200
    assert client.post("/oauth/revoke", data={"client_id": client_id, "token": tokens["refresh_token"]}).status_code == 200
    assert mcp(client, tokens["access_token"]).status_code == 401


def test_confidential_clients_must_present_their_secret(flow):
    client, _ = flow
    registered = register(client, token_endpoint_auth_method="client_secret_post").json
    code = authorize(client, registered["client_id"])
    assert exchange(client, registered["client_id"], code).status_code == 401
    assert exchange(client, registered["client_id"], code, client_secret="wrong").status_code == 401
    assert exchange(client, registered["client_id"], code, client_secret=registered["client_secret"]).status_code == 200
    basic = register(client, token_endpoint_auth_method="client_secret_basic").json
    credentials = base64.b64encode(f"{basic['client_id']}:{basic['client_secret']}".encode()).decode()
    response = client.post("/oauth/token", headers={"Authorization": f"Basic {credentials}"}, data={
        "grant_type": "authorization_code", "code": authorize(client, basic["client_id"]), "code_verifier": VERIFIER})
    assert response.status_code == 200


def test_native_clients_may_listen_on_any_loopback_port(flow):
    client, _ = flow
    client_id = register(client, client_name="Claude Code", redirect_uris=["http://localhost:1234/callback"]).json["client_id"]
    params = request_params(client_id, redirect_uri="http://localhost:54321/callback")
    preview = client.post("/oauth/authorize/preview", headers=WEB, json={"params": params})
    assert preview.json["redirect_host"] == "localhost" and preview.json["local"] is True
    decision = client.post("/oauth/authorize/decision", headers=WEB, json={"params": params, "approve": True})
    assert decision.json["redirect_to"].startswith("http://localhost:54321/callback?code=")


@pytest.mark.parametrize("metadata", [
    {"redirect_uris": []},
    {"redirect_uris": ["http://evil.example/cb"]},
    {"redirect_uris": ["javascript:alert(1)"]},
    {"redirect_uris": ["https://ok.example/cb#fragment"]},
    {"redirect_uris": ["https://ok.example/cb"] * 11},
    {"grant_types": ["client_credentials"]},
    {"grant_types": ["authorization_code", "password"]},
    {"token_endpoint_auth_method": "private_key_jwt"},
    {"response_types": ["token"]},
])
def test_registration_rejects_unsafe_metadata(flow, metadata):
    client, db = flow
    response = register(client, **metadata)
    assert response.status_code == 400 and response.json["error"] in {"invalid_redirect_uri", "invalid_client_metadata"}
    assert not db.docs("oauth_clients")


def test_redirect_rules():
    assert valid_redirect("https://claude.ai/api/mcp/auth_callback") and valid_redirect("http://127.0.0.1:8976/cb")
    assert valid_redirect("cursor://anysphere.cursor-mcp/oauth/callback")
    for bad in ["http://example.com/cb", "data:text/html,x", "file:///etc/passwd", "https:///nohost", "https://a b.example/", "", None]:
        assert not valid_redirect(bad)
    assert same_redirect("http://localhost:5/cb", "http://localhost:9/cb")
    assert not same_redirect("http://localhost:5/other", "http://localhost:9/cb")
    assert not same_redirect("https://claude.ai:444/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback")


def test_public_oauth_endpoints_answer_any_origin_but_the_mcp_endpoint_does_not(flow):
    client, _ = flow
    elsewhere = {"Origin": "https://inspector.example"}
    metadata = client.get("/.well-known/oauth-authorization-server", headers=elsewhere)
    assert metadata.status_code == 200 and metadata.headers["Access-Control-Allow-Origin"] == "*"
    assert client.options("/oauth/token", headers=elsewhere).status_code == 204
    assert client.post("/oauth/register", json={"redirect_uris": [CALLBACK]}, headers=elsewhere).status_code == 201
    assert client.post("/mcp", json={}, headers=elsewhere).status_code == 403


def test_without_public_urls_there_is_no_oauth_and_the_pilot_token_stays_limited(monkeypatch):
    for name in ("FLOWT_PUBLIC_BASE_URL", "FLOWT_CONSENT_URL", "FLOWT_REVIEW_ALLOWED_ORIGINS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FLOWT_MCP_TOKEN", "p" * 40)
    monkeypatch.setenv("FLOWT_MCP_OWNER_UID", "owner")
    monkeypatch.setattr("mcp_server.auth.verify_id_token", Mock(side_effect=ValueError("not a Firebase token")))
    finance = Mock()
    client = create_app(service=Mock(), finance=finance).test_client()
    assert client.get("/.well-known/oauth-protected-resource").status_code == 404
    assert client.post("/oauth/register", json={"redirect_uris": [CALLBACK]}).status_code == 404
    unauthorized = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert unauthorized.status_code == 401 and "WWW-Authenticate" not in unauthorized.headers
    names = {t["name"] for t in mcp(client, "p" * 40).json["result"]["tools"]}
    assert "apply_review" in names and "list_pending_reviews" in names and "create_movement" not in names and "get_overview" not in names
    for name, arguments in [("get_overview", {}), ("update_movement", {"movement_id": "m", "name": "Manual"})]:
        assert call(client, "p" * 40, name, arguments)["content"][0]["text"].startswith("insufficient_scope:")
    assert not finance.mock_calls


def test_connector_writes_can_be_switched_off(flow, monkeypatch):
    client, db = flow
    _, tokens = connect(client)
    monkeypatch.setenv("FLOWT_MCP_WRITES_ENABLED", "false")
    names = {t["name"] for t in mcp(client, tokens["access_token"]).json["result"]["tools"]}
    assert "list_movements" in names and "create_movement" not in names
    result = call(client, tokens["access_token"], "transfer_between_huchas", {"from_hucha_id": "main", "to_hucha_id": "x", "importe": 1})
    assert result["content"][0]["text"].startswith("writes_disabled:") and db.doc("huchas", "main")["saldo_acumulado"] == 100
