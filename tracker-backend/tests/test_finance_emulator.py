"""Finance tools and the OAuth store on the real SDK, opt-in against a local emulator only."""
import base64
import hashlib
import os
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from finance.service import FinanceService
from mcp_auth import AuthorizationServer, OAuthError, Settings

BASE = "https://flowt.example"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


@pytest.fixture
def emulator():
    host = os.getenv("FIRESTORE_EMULATOR_HOST")
    if not host:
        pytest.skip("FIRESTORE_EMULATOR_HOST is absent; no real Firestore integration was run")
    if host.split(":")[0] not in {"127.0.0.1", "localhost"}:
        pytest.fail("Finance integration tests require a loopback Firestore emulator")
    db = firestore.Client(project="demo-flowt-test", credentials=AnonymousCredentials())
    owner = "finance-test-" + uuid4().hex
    wallets = {"main": {"nombre": "Cuenta", "tipo_aportacion": "resto", "es_principal": True, "saldo_acumulado": 1000, "orden": 1},
               "trip": {"nombre": "Viaje", "tipo_aportacion": "porcentaje", "valor_aportacion": 10, "saldo_acumulado": 200,
                        "objetivo": 250, "tope_objetivo": True, "orden": 2}}
    ids = {name: f"{owner}-{name}" for name in wallets}
    for name, data in wallets.items():
        db.collection("huchas").document(ids[name]).set({**data, "id_propietario": owner, "activa": True})
    clients = []
    try:
        yield {"db": db, "owner": owner, "ids": ids, "clients": clients}
    finally:
        # Explicit owner-scoped documents only; never a recursive delete.
        for collection in ["huchas", "movimientos", "suscripciones", "mcp_operations", "oauth_grants", "oauth_tokens", "oauth_codes"]:
            for snapshot in db.collection(collection).where(filter=FieldFilter("id_propietario", "==", owner)).stream():
                snapshot.reference.delete()
        db.collection("stats").document(owner).delete()
        for client_id in clients:
            db.collection("oauth_clients").document(client_id).delete()


def balances(env):
    return {name: env["db"].collection("huchas").document(key).get().to_dict()["saldo_acumulado"] for name, key in env["ids"].items()}


def test_money_moves_atomically_and_retries_apply_once(emulator):
    service, owner, ids = FinanceService(emulator["db"]), emulator["owner"], emulator["ids"]
    income = {"tipo": "ingreso", "concepto": "Nómina", "importe": 1000, "fecha_operacion": "2026-10-01", "operation_id": "payday"}
    first = service.create_movement(owner, **income)
    assert service.create_movement(owner, **income) == first
    assert balances(emulator) == {"main": 1950, "trip": 250}
    expense = service.create_movement(owner, tipo="gasto", concepto="Súper", importe=84.5, fecha_operacion="2026-10-02", hucha_id=ids["trip"])
    assert balances(emulator) == {"main": 1950, "trip": 165.5}
    listed = service.list_movements(owner, limit=1)
    assert listed["items"][0]["concepto"] == "Súper" and listed["next_cursor"]
    assert service.list_movements(owner, limit=1, cursor=listed["next_cursor"])["items"][0]["concepto"] == "Nómina"
    summary = service.summarize_movements(owner, start_date="2026-10-01", end_date="2026-11-01", group_by="month")
    assert summary["totals"] == {"ingresos": 1000.0, "gastos": 84.5}
    service.transfer_between_huchas(owner, from_hucha_id=ids["main"], to_hucha_id=ids["trip"], importe=50)
    assert balances(emulator) == {"main": 1900, "trip": 215.5}
    service.delete_movement(owner, movement_id=expense["movement"]["id"])
    service.delete_movement(owner, movement_id=first["movement"]["id"])
    assert balances(emulator) == {"main": 950, "trip": 250}
    assert service.list_movements(owner)["items"] == []
    stats = emulator["db"].collection("stats").document(owner).get().to_dict()
    assert stats["total_ingresos"] == 0 and stats["total_gastos"] == 0


def test_subscription_creates_and_updates_the_automatic_wallet(emulator):
    service, owner = FinanceService(emulator["db"]), emulator["owner"]
    created = service.create_subscription(owner, nombre="Netflix", importe=17.99, dia_pago=12, categoria="streaming")
    system = emulator["db"].collection("huchas").document(created["subscriptions_hucha"]["hucha_id"]).get().to_dict()
    assert system["es_suscripciones"] is True and system["objetivo"] == 17.99
    service.delete_subscription(owner, subscription_id=created["subscription"]["id"])
    system = emulator["db"].collection("huchas").document(created["subscriptions_hucha"]["hucha_id"]).get().to_dict()
    assert system["objetivo"] is None and system["valor_aportacion"] == 0


def test_oauth_store_round_trip(emulator):
    server = AuthorizationServer(emulator["db"], Settings(BASE, BASE + "/conectar"))
    client_id = server.register({"client_name": "Claude", "redirect_uris": [CALLBACK]})["client_id"]
    emulator["clients"].append(client_id)
    params = {"response_type": "code", "client_id": client_id, "redirect_uri": CALLBACK, "state": "s",
              "code_challenge": CHALLENGE, "code_challenge_method": "S256", "resource": BASE + "/mcp"}
    code = parse_qs(urlsplit(server.decide(emulator["owner"], params, approve=True)).query)["code"][0]
    form = {"grant_type": "authorization_code", "client_id": client_id, "code": code, "code_verifier": VERIFIER, "redirect_uri": CALLBACK}
    tokens = server.token(form)
    assert server.authenticate(tokens["access_token"]) == (emulator["owner"], frozenset({"flowt:read", "flowt:write"}))
    renewed = server.token({"grant_type": "refresh_token", "client_id": client_id, "refresh_token": tokens["refresh_token"]})
    assert server.authenticate(renewed["access_token"])
    with pytest.raises(OAuthError):
        server.token(form)  # A replayed code ends the connection.
    assert server.authenticate(renewed["access_token"]) is None
    assert server.connections(emulator["owner"]) == []
