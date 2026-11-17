"""Offline HTTP and google-genai contract tests for ticket scanning."""
import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest
from google.genai import types

import mcp_server
from finance.tickets import MAX_TICKET_BODY, NOT_A_TICKET, TicketRateLimiter
from reviews.domain import ReviewError

CASES = json.loads((Path(__file__).parents[1] / "finance" / "ticket_cases.json").read_text(encoding="utf-8"))
INPUT = {"image": "aW1hZ2U=", "mime": "image/jpeg"}
HEADERS = {"Authorization": "Bearer valid", "Origin": "https://flowt.example"}
PATH = "/api/tickets/scan"


def model_output(raw=None, finish_reason="STOP"):
    text = json.dumps(CASES[0]["entrada"]) if raw is None else raw
    return types.GenerateContentResponse(candidates=[types.Candidate(
        finish_reason=finish_reason, content=types.Content(parts=[types.Part(text=text)]),
    )])


@pytest.fixture
def transport(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("TICKET_AI_MODEL", raising=False)
    monkeypatch.setenv("FLOWT_REVIEW_ALLOWED_ORIGINS", "https://flowt.example")
    gemini = Mock()
    gemini.models.generate_content.return_value = model_output()
    clock = {"now": 0}

    def verifier(header):
        if header not in ("Bearer valid", "Bearer other"):
            raise ReviewError("unauthorized", "Credenciales no válidas")
        return mcp_server.ALLOWED_UIDS[0 if header == "Bearer valid" else 1]

    app = mcp_server.create_app(
        service=Mock(), verifier=verifier, ticket_client=gemini,
        ticket_now=lambda: datetime(2026, 11, 17, 12, tzinfo=timezone.utc),
        ticket_limiter=TicketRateLimiter(now=lambda: clock["now"]),
    )
    app.config["TESTING"] = True
    return app.test_client(), gemini, clock


def scan(client, body=INPUT, headers=HEADERS):
    # json=None does not send a JSON body with Flask's test client.
    return client.post(PATH, data=json.dumps(body), content_type="application/json", headers=headers)


def test_contract_and_sdk_request(transport):
    client, gemini, _ = transport
    response = scan(client)
    assert response.status_code == 200
    assert response.json == CASES[0]["esperado"]
    args = gemini.models.generate_content.call_args.kwargs
    assert args["model"] == "gemini-3.5-flash"
    assert args["contents"][1].inline_data.data == b"image"
    assert args["contents"][1].inline_data.mime_type == "image/jpeg"
    assert "alimentacion" in args["contents"][0]
    assert args["config"].response_mime_type == "application/json"
    assert args["config"].response_schema["type"] == "OBJECT"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Access-Control-Allow-Origin"] == HEADERS["Origin"]


def test_custom_model(transport, monkeypatch):
    client, gemini, _ = transport
    monkeypatch.setenv("TICKET_AI_MODEL", "custom-model")
    assert scan(client).status_code == 200
    assert gemini.models.generate_content.call_args.kwargs["model"] == "custom-model"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid"}, {"Authorization": "Bearer flowt_pilot"}])
def test_requires_firebase_session(transport, headers):
    client, gemini, _ = transport
    assert scan(client, headers=headers).status_code == 401
    gemini.models.generate_content.assert_not_called()


def test_cors_preflight_and_method(transport):
    client, gemini, _ = transport
    assert scan(client, headers={**HEADERS, "Origin": "https://stranger.example"}).status_code == 403
    assert client.options(PATH, headers={"Origin": HEADERS["Origin"]}).status_code == 204
    assert client.get(PATH, headers=HEADERS).status_code == 405
    gemini.models.generate_content.assert_not_called()


def test_large_image_allowed_only_on_ticket_route(transport):
    client, _, _ = transport
    assert scan(client, {**INPUT, "image": "a" * 100_000}).status_code == 200
    response = client.post("/mcp", json={"pad": "a" * 100_000}, headers=HEADERS)
    assert response.status_code == 413
    assert client.application.config["MAX_CONTENT_LENGTH"] == 64 * 1024


def test_two_mb_body_limit(transport):
    client, gemini, _ = transport
    response = scan(client, {**INPUT, "image": "a" * MAX_TICKET_BODY})
    assert response.status_code == 413
    assert response.json == {"error": "payload_too_large", "message": "Petición demasiado grande"}
    assert response.headers["Access-Control-Allow-Origin"] == HEADERS["Origin"]
    gemini.models.generate_content.assert_not_called()


def test_body_limit_without_content_length(transport):
    from io import BytesIO
    client, gemini, _ = transport
    response = client.open(PATH, method="POST", headers=HEADERS, content_type="application/json",
                           environ_overrides={"wsgi.input": BytesIO(b"x" * (MAX_TICKET_BODY + 1)),
                                              "wsgi.input_terminated": True, "CONTENT_LENGTH": ""})
    assert response.status_code == 413
    gemini.models.generate_content.assert_not_called()


def test_limit_counts_utf8_bytes(transport):
    client, gemini, _ = transport
    response = client.post(PATH, data=json.dumps({**INPUT, "extra": "é" * (MAX_TICKET_BODY // 2)}, ensure_ascii=False).encode(),
                           content_type="application/json", headers=HEADERS)
    assert response.status_code == 413
    gemini.models.generate_content.assert_not_called()


@pytest.mark.parametrize("body", [None, {}, [], {**INPUT, "mime": "image/gif"}, {**INPUT, "image": "data:image/jpeg;base64,aW1hZ2U="},
                                   {**INPUT, "image": "not base64"}, {**INPUT, "image": ""}, {**INPUT, "image": "a==="}])
def test_invalid_image_input(transport, body):
    client, gemini, _ = transport
    response = scan(client, body)
    assert response.status_code == 400
    assert response.json["error"] == "invalid_arguments"
    gemini.models.generate_content.assert_not_called()


def test_malformed_json(transport):
    client, _, _ = transport
    assert client.post(PATH, data="{bad json", headers=HEADERS).status_code == 400


def test_missing_configuration(transport, monkeypatch):
    client, gemini, _ = transport
    monkeypatch.delenv("GEMINI_API_KEY")
    response = scan(client)
    assert response.status_code == 503
    assert response.json == {"error": "not_configured", "message": "El escaneo de tickets no está configurado"}
    gemini.models.generate_content.assert_not_called()


@pytest.mark.parametrize("raw", ["garbage", "null", "{}", "[]"])
def test_garbage_model_output(transport, raw):
    client, gemini, _ = transport
    gemini.models.generate_content.return_value = model_output(raw)
    response = scan(client)
    assert response.status_code == 422
    assert response.json == {"error": "not_a_ticket", "message": NOT_A_TICKET}


@pytest.mark.parametrize("response", [types.GenerateContentResponse(), types.GenerateContentResponse(candidates=[]),
                                      model_output(finish_reason="MAX_TOKENS")])
def test_missing_or_truncated_content(transport, response):
    client, gemini, _ = transport
    gemini.models.generate_content.return_value = response
    assert scan(client).status_code == 422


def test_sanitizes_model_output_through_http(transport):
    client, gemini, _ = transport
    case = next(case for case in CASES if case["nombre"].startswith("redondeo"))
    gemini.models.generate_content.return_value = model_output(json.dumps({**case["entrada"], "fecha": "2099-01-01", "categoria_sugerida": "nomina"}))
    assert scan(client).json == {**case["esperado"], "fecha": None, "categoria_sugerida": "sin_categorizar"}


def test_rate_limit_per_uid_and_window(transport):
    client, gemini, clock = transport
    for _ in range(10):
        assert scan(client).status_code == 200
    response = scan(client)
    assert response.status_code == 429
    assert response.json == {"error": "rate_limited", "message": "Has alcanzado el límite de 10 escaneos por minuto"}
    assert response.headers["Retry-After"] == "60"
    assert gemini.models.generate_content.call_count == 10
    assert scan(client, headers={**HEADERS, "Authorization": "Bearer other"}).status_code == 200
    clock["now"] += 60
    assert scan(client).status_code == 200


def test_provider_exception_does_not_leak_image(transport, caplog):
    client, gemini, _ = transport
    gemini.models.generate_content.side_effect = RuntimeError(INPUT["image"])
    response = scan(client)
    assert response.status_code == 503
    assert response.json == {"error": "retryable_error", "message": "No se pudo completar la operación"}
    assert INPUT["image"] not in caplog.text


def test_bundled_allowlist_matches_worker():
    canonical = Path(__file__).parents[2] / "src" / "shared" / "allowedUids.json"
    assert mcp_server.ALLOWED_UIDS == json.loads(canonical.read_text(encoding="utf-8"))


@pytest.mark.parametrize("uid", [mcp_server.ALLOWED_UIDS[0], "not-permitted"])
def test_ticket_route_checks_allowlist_after_real_web_verifier(monkeypatch, uid):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(mcp_server.firebase_admin, "_apps", {"test": True})
    verify = Mock(return_value={"uid": uid})
    monkeypatch.setattr(mcp_server.auth, "verify_id_token", verify)
    gemini = Mock()
    gemini.models.generate_content.return_value = model_output()
    client = mcp_server.create_app(ticket_client=gemini).test_client()
    response = scan(client, headers={"Authorization": "Bearer valid"})
    assert response.status_code == (200 if uid in mcp_server.ALLOWED_UIDS else 401)
    if uid not in mcp_server.ALLOWED_UIDS:
        assert response.json["error"] == "unauthorized"
        gemini.models.generate_content.assert_not_called()
    verify.assert_called_once_with("valid", check_revoked=True)
