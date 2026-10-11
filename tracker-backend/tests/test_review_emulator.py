"""Real SDK/transaction integration, opt-in against a local emulator only."""
import os
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from reviews.service import ReviewService, document_id


@pytest.fixture
def emulator():
    host = os.getenv("FIRESTORE_EMULATOR_HOST")
    if not host:
        pytest.skip("FIRESTORE_EMULATOR_HOST is absent; no real Firestore integration was run")
    if host.split(":")[0] not in {"127.0.0.1", "localhost"}:
        pytest.fail("Review integration tests require a loopback Firestore emulator")
    db = firestore.Client(project="demo-flowt-test", credentials=AnonymousCredentials())
    owner = "review-test-" + uuid4().hex
    refs = []

    def put(collection, key, data):
        ref = db.collection(collection).document(key)
        ref.set(data)
        refs.append(ref)
        return ref

    main_id, food_id, system_id = [f"{owner}-{suffix}" for suffix in ["main", "food", "system"]]
    movement_ids = [f"{owner}-{suffix}" for suffix in ["july", "august", "september"]]
    receipt_id, email_id = owner + "-receipt", owner + "-email"
    for key, month in zip(movement_ids, [7, 8, 9]):
        put("movimientos", key, {"id_propietario": owner, "email_id": email_id, "tipo": "gasto",
            "concepto": "Bank membership charge", "importe": 12, "moneda": "EUR", "review_version": 0,
            "hucha_id": main_id, "fecha_operacion": datetime(2026, month, 15, tzinfo=timezone.utc)})
        put("review_jobs", document_id(owner, key), {"id_propietario": owner, "movement_id": key,
            "processing_id": receipt_id, "state": "pending", "email_id": email_id})
    put("email_processing", receipt_id, {"id_propietario": owner, "state": "completed",
        "branches_resolved": True, "movement_ids": movement_ids, "email_id": email_id})
    put("huchas", main_id, {"id_propietario": owner, "saldo_acumulado": 100, "es_principal": True})
    put("huchas", food_id, {"id_propietario": owner, "saldo_acumulado": 50})
    put("huchas", system_id, {"id_propietario": owner, "es_suscripciones": True,
        "saldo_acumulado": 80, "objetivo": 10, "valor_aportacion": 10, "tipo_aportacion": "flat", "tope_objetivo": False})
    put("suscripciones", owner + "-annual", {"id_propietario": owner, "nombre": "Existing annual",
        "importe": 120, "frecuencia": "anual", "hucha_id": system_id, "activa": True})
    put("review_configuration", owner, {"revision": 1, "category_huchas": {"custom-review": food_id}})
    custom_ref = db.collection("categorias").document(owner).collection("items").document("custom-review")
    custom_ref.set({"nombre": "Custom review", "tipo": "gasto"})
    refs.append(custom_ref)
    service = ReviewService(db, writes_enabled=True)
    try:
        yield {"db": db, "owner": owner, "service": service, "movements": movement_ids,
               "main": main_id, "food": food_id, "system": system_id}
    finally:
        # Explicit owner-scoped documents only. Never recursively delete a tree
        # or use a production Admin client; generated audit/sub docs are scoped.
        for collection in ["review_history", "suscripciones"]:
            for snap in db.collection(collection).where(filter=FieldFilter("id_propietario", "==", owner)).stream():
                snap.reference.delete()
        for ref in refs:
            ref.delete()
        db.close()


def proposal_for(env, operation="apply"):
    mid = env["movements"][-1]
    context = env["service"].get_movement_context(env["owner"], mid)
    return {"operation_id": operation, "expected_version": context["version"], "configuration_revision": 1,
            "reason": "Receipt identifies the purchase", "name": "Membership", "category": "custom-review"}


def test_real_timestamp_apply_idempotency_and_inverse_balance_reversal(emulator):
    env = emulator
    db, service, owner, mid = env["db"], env["service"], env["owner"], env["movements"][-1]
    proposal = proposal_for(env)
    snapshot = db.collection("movimientos").document(mid).get()
    # Pass the real SDK timestamp unchanged, including nanoseconds if present.
    assert proposal["expected_version"] == snapshot.update_time.isoformat()
    preview = service.preview_review(owner, mid, proposal)
    assert preview["hucha_deltas"] == {env["main"]: 1200, env["food"]: -1200}
    assert db.collection("movimientos").document(mid).get().update_time == snapshot.update_time
    result = service.apply_review(owner, mid, proposal)
    after = db.collection("movimientos").document(mid).get()
    assert service.apply_review(owner, mid, proposal) == result
    assert db.collection("movimientos").document(mid).get().update_time == after.update_time
    main = db.collection("huchas").document(env["main"])
    assert main.get().to_dict()["saldo_acumulado"] == 112
    main.update({"saldo_acumulado": firestore.Increment(30)})
    assert service.revert_review(owner, result["review_id"])["reverted"] is True
    assert main.get().to_dict()["saldo_acumulado"] == 130
    restored = db.collection("movimientos").document(mid).get().to_dict()
    assert restored["concepto"] == "Bank membership charge"
    assert "categoria" not in restored
    assert "concepto" in restored["review_protected_fields"]


def test_real_subscription_links_system_target_and_reversal(emulator):
    env = emulator
    db, service, owner, mid = env["db"], env["service"], env["owner"], env["movements"][-1]
    db.collection("review_configuration").document(owner).update({"category_huchas": {}})
    proposal = proposal_for(env, "create-subscription")
    proposal["new_subscription"] = {"name": "Membership", "amount": 12, "frequency": "monthly", "day": 15,
        "anchor_date": "2026-07-15", "evidence_movement_ids": env["movements"], "reason": "Three consecutive months"}
    result = service.apply_review(owner, mid, proposal)
    sid = db.collection("movimientos").document(mid).get().to_dict()["suscripcion_id"]
    assert db.collection("suscripciones").document(sid).get().exists
    for movement_id in env["movements"]:
        assert db.collection("movimientos").document(movement_id).get().to_dict()["suscripcion_id"] == sid
    system = db.collection("huchas").document(env["system"])
    assert system.get().to_dict()["objetivo"] == 22
    assert system.get().to_dict()["valor_aportacion"] == 22
    service.revert_review(owner, result["review_id"])
    assert not db.collection("suscripciones").document(sid).get().exists
    assert system.get().to_dict()["objetivo"] == 10
    for movement_id in env["movements"]:
        assert "suscripcion_id" not in db.collection("movimientos").document(movement_id).get().to_dict()


def test_real_search_and_pending_cursor_pagination(emulator):
    env = emulator
    service, owner = env["service"], env["owner"]
    first = service.search_related_movements(owner, "2026-07-01T00:00:00Z", "2026-10-01T00:00:00Z", limit=2)
    second = service.search_related_movements(owner, "2026-07-01T00:00:00Z", "2026-10-01T00:00:00Z", limit=2, cursor=first["next_cursor"])
    assert [item["id"] for item in first["items"] + second["items"]] == env["movements"]
    pending1 = service.list_pending_reviews(owner, limit=2)
    pending2 = service.list_pending_reviews(owner, limit=2, cursor=pending1["next_cursor"])
    ids = [item["movement_id"] for item in pending1["items"] + pending2["items"]]
    assert len(ids) == len(set(ids)) == 3
    assert set(ids) == set(env["movements"])


def test_real_manual_category_uses_shared_balance_plan_and_blocks_auto_revert(emulator):
    from reviews.domain import ReviewError
    env = emulator
    service, owner, mid = env["service"], env["owner"], env["movements"][-1]
    result = service.apply_review(owner, mid, proposal_for(env))
    service.writes_enabled = False
    service.edit_movement(owner, mid, name="My explicit choice")
    movement = env["db"].collection("movimientos").document(mid).get().to_dict()
    assert movement["concepto"] == "My explicit choice"
    assert "concepto" in movement["review_protected_fields"]
    service.writes_enabled = True
    with pytest.raises(ReviewError) as error:
        service.revert_review(owner, result["review_id"])
    assert error.value.code == "revert_conflict"


def test_real_search_excludes_new_movements_until_receipt_completed(emulator):
    env = emulator
    service, owner = env["service"], env["owner"]
    email_id = env["db"].collection("movimientos").document(env["movements"][0]).get().to_dict()["email_id"]
    receipt = env["db"].collection("email_processing").document(document_id(owner, email_id))
    try:
        receipt.set({"id_propietario": owner, "state": "processing"})
        result = service.search_related_movements(owner, "2026-07-01T00:00:00Z", "2026-10-01T00:00:00Z")
        assert result["items"] == []
        receipt.update({"state": "completed"})
        result = service.search_related_movements(owner, "2026-07-01T00:00:00Z", "2026-10-01T00:00:00Z")
        assert len(result["items"]) == 3
    finally:
        receipt.delete()
