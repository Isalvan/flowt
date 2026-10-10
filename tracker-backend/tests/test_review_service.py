"""Exercise the real service and financial planner against an atomic memory DB."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from firebase_admin import firestore

from reviews.domain import ReviewError
from reviews.service import ReviewService, document_id


class Snapshot:
    def __init__(self, ref):
        self.reference, self.id = ref, ref.id
        self.exists = ref.key in ref.db.data
        self.update_time = ref.db.versions.get(ref.key)
        self.data = deepcopy(ref.db.data.get(ref.key))

    def to_dict(self):
        return deepcopy(self.data)


class Ref:
    def __init__(self, db, collection, key):
        self.db, self.collection_name, self.id = db, collection, key
        self.key = (collection, key)

    def get(self, transaction=None):
        if transaction and transaction.writes:
            raise AssertionError("Firestore cannot read after a transaction write")
        return Snapshot(self)

    def collection(self, name):
        return Query(self.db, f"{self.collection_name}/{self.id}/{name}")


class Query:
    def __init__(self, db, name, filters=(), cap=None):
        self.db, self.name, self.filters, self.cap = db, name, filters, cap

    def document(self, key):
        return Ref(self.db, self.name, key)

    def where(self, *, filter):
        return Query(self.db, self.name, (*self.filters, filter), self.cap)

    def limit(self, cap):
        return Query(self.db, self.name, self.filters, cap)

    def stream(self, transaction=None):
        if transaction and transaction.writes:
            raise AssertionError("Firestore cannot query after a transaction write")
        emitted = 0
        for collection, key in sorted(self.db.data):
            if collection != self.name:
                continue
            data = self.db.data[(collection, key)]
            if all(data.get(f.field_path) == f.value for f in self.filters):
                if self.cap is not None and emitted >= self.cap:
                    return
                emitted += 1
                yield Snapshot(Ref(self.db, collection, key))


class Transaction:
    def __init__(self, db):
        self.db, self.writes = db, []

    def update(self, ref, values):
        assert ref.key in self.db.data
        self.writes.append(("update", ref, values))

    def create(self, ref, values):
        assert ref.key not in self.db.data
        self.writes.append(("create", ref, values))

    def delete(self, ref):
        self.writes.append(("delete", ref, {}))

    def commit(self):
        timestamp = self.db.tick()
        for op, ref, values in self.writes:
            if op == "delete":
                del self.db.data[ref.key]
                self.db.versions.pop(ref.key, None)
                continue
            current = deepcopy(self.db.data.get(ref.key, {}))
            for key, value in values.items():
                if value is firestore.DELETE_FIELD:
                    current.pop(key, None)
                else:
                    current[key] = timestamp if value is firestore.SERVER_TIMESTAMP else deepcopy(value)
            self.db.data[ref.key] = current
            self.db.versions[ref.key] = timestamp
        self.db.committed_writes += len(self.writes)


class MemoryDB:
    def __init__(self):
        self.data, self.versions = {}, {}
        self.sequence, self.committed_writes = 0, 0

    def tick(self):
        self.sequence += 1
        return datetime(2026, 10, 4, tzinfo=timezone.utc) + timedelta(microseconds=self.sequence)

    def collection(self, name):
        return Query(self, name)

    def put(self, collection, key, data):
        self.data[(collection, key)] = deepcopy(data)
        self.versions[(collection, key)] = self.tick()

    def atomic(self, operation):
        tx = Transaction(self)
        result = operation(tx)
        tx.commit()
        return result


@pytest.fixture
def setup():
    db = MemoryDB()
    movement = {"id_propietario": "owner", "email_id": "email", "tipo": "gasto", "concepto": "Bank charge",
                "importe": 12, "hucha_id": "main", "fecha_operacion": datetime(2026, 10, 3, tzinfo=timezone.utc),
                "review_version": 0, "moneda": "EUR"}
    db.put("movimientos", "movement", movement)
    db.put("huchas", "main", {"id_propietario": "owner", "saldo_acumulado": 100, "es_principal": True})
    db.put("huchas", "food", {"id_propietario": "owner", "saldo_acumulado": 50})
    db.put("categorias/owner/items", "custom-food", {"nombre": "Food", "tipo": "gasto"})
    db.put("review_configuration", "owner", {"revision": 1, "category_huchas": {"custom-food": "food"}})
    db.put("email_processing", "receipt", {"id_propietario": "owner", "state": "completed", "movement_ids": ["movement"]})
    db.put("review_jobs", document_id("owner", "movement"), {"id_propietario": "owner", "movement_id": "movement", "processing_id": "receipt", "state": "pending"})
    service = ReviewService(db, writes_enabled=True)
    service._atomic = db.atomic
    proposal = {"operation_id": "operation", "expected_version": db.versions[("movimientos", "movement")].isoformat(),
                "configuration_revision": 1, "reason": "Receipt identifies purchase", "name": "Groceries", "category": "custom-food"}
    return db, service, proposal


def expect_failure(setup, code, owner="owner", proposal=None):
    db, service, original = setup
    before = deepcopy(db.data)
    writes = db.committed_writes
    with pytest.raises(ReviewError) as exc:
        service.apply_review(owner, "movement", proposal or original)
    assert exc.value.code == code
    assert db.data == before
    assert db.committed_writes == writes


def test_preview_uses_real_financial_plan_without_writes(setup):
    db, service, proposal = setup
    before = deepcopy(db.data)
    plan = service.preview_review("owner", "movement", proposal)
    assert plan["movement_changes"]["hucha_id"] == "food"
    assert plan["hucha_deltas"] == {"main": 1200, "food": -1200}
    assert db.data == before
    assert db.committed_writes == 0


def test_related_evidence_waits_for_its_processing_receipt(setup):
    db, service, _ = setup
    movement = db.data[("movimientos", "movement")]
    processing_id = document_id("owner", "email")
    db.put("email_processing", processing_id, {"id_propietario": "owner", "state": "processing"})
    assert not service._related_processing_complete("owner", movement)
    db.put("email_processing", processing_id, {"id_propietario": "owner", "state": "completed"})
    assert service._related_processing_complete("owner", movement)


def test_legacy_evidence_without_receipt_remains_searchable(setup):
    db, service, _ = setup
    assert service._related_processing_complete("owner", db.data[("movimientos", "movement")])


def test_apply_retry_returns_original_result_without_duplicate_effects(setup):
    db, service, proposal = setup
    first = service.apply_review("owner", "movement", proposal)
    before, writes = deepcopy(db.data), db.committed_writes
    second = service.apply_review("owner", "movement", proposal)
    assert second == first
    assert db.data == before
    assert db.committed_writes == writes
    assert db.data[("huchas", "main")]["saldo_acumulado"] == 112
    assert db.data[("huchas", "food")]["saldo_acumulado"] == 38
    assert db.data[("movimientos", "movement")]["review_version"] == 1


def test_operation_id_reuse_with_other_payload_is_conflict(setup):
    _, service, proposal = setup
    service.apply_review("owner", "movement", proposal)
    expect_failure(setup, "operation_conflict", proposal={**proposal, "name": "Different purchase"})


def test_owner_cannot_access_another_users_movement(setup):
    expect_failure(setup, "not_found", owner="other")


def test_incomplete_email_cannot_be_reviewed(setup):
    db, _, _ = setup
    db.data[("email_processing", "receipt")]["state"] = "processing"
    expect_failure(setup, "processing_incomplete")


def test_concurrent_manual_edit_invalidates_timestamp_even_without_counter_update(setup):
    db, _, _ = setup
    current = db.data[("movimientos", "movement")]
    db.put("movimientos", "movement", {**current, "concepto": "Manual choice"})
    expect_failure(setup, "version_conflict")


def test_configuration_change_is_conflict(setup):
    db, _, _ = setup
    db.data[("review_configuration", "owner")]["revision"] = 2
    expect_failure(setup, "configuration_conflict")


def test_revert_restores_fields_and_applies_inverse_to_current_balances(setup):
    db, service, proposal = setup
    result = service.apply_review("owner", "movement", proposal)
    # Subsequent unrelated income must survive undo.
    db.data[("huchas", "main")]["saldo_acumulado"] += 30
    reverted = service.revert_review("owner", result["review_id"])
    assert reverted["reverted"] is True
    movement = db.data[("movimientos", "movement")]
    assert movement["concepto"] == "Bank charge" and movement["hucha_id"] == "main"
    assert "categoria" not in movement
    assert set(movement["review_protected_fields"]) == {"concepto", "categoria", "hucha_id"}
    assert db.data[("huchas", "main")]["saldo_acumulado"] == 130
    assert db.data[("huchas", "food")]["saldo_acumulado"] == 50
    before = deepcopy(db.data)
    service.revert_review("owner", result["review_id"])
    assert db.data == before


def test_revert_rejects_later_manual_field_change_without_partial_refund(setup):
    db, service, proposal = setup
    result = service.apply_review("owner", "movement", proposal)
    db.data[("movimientos", "movement")]["concepto"] = "Later edit"
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.revert_review("owner", result["review_id"])
    assert exc.value.code == "revert_conflict"
    assert db.data == before


def subscription_proposal(db, proposal):
    for id, month in [("july", 7), ("august", 8)]:
        db.put("movimientos", id, {**db.data[("movimientos", "movement")], "fecha_operacion": datetime(2026, month, 15, tzinfo=timezone.utc)})
    # Dates/amounts may vary: only consecutive calendar months are mandatory.
    db.data[("movimientos", "movement")]["fecha_operacion"] = datetime(2026, 9, 20, tzinfo=timezone.utc)
    return {**proposal, "new_subscription": {"name": "Membership", "amount": 12, "frequency": "monthly", "day": 15,
        "anchor_date": "2026-07-15", "evidence_movement_ids": ["july", "august", "movement"], "reason": "Three consecutive membership payments"}}


def test_new_subscription_links_all_real_evidence_and_can_be_reverted(setup):
    db, service, proposal = setup
    proposal = subscription_proposal(db, proposal)
    result = service.apply_review("owner", "movement", proposal)
    sid = db.data[("movimientos", "movement")]["suscripcion_id"]
    assert db.data[("suscripciones", sid)]["nombre"] == "Membership"
    for id in ["july", "august", "movement"]:
        assert db.data[("movimientos", id)]["suscripcion_id"] == sid
    service.revert_review("owner", result["review_id"])
    assert ("suscripciones", sid) not in db.data
    for id in ["july", "august", "movement"]:
        assert "suscripcion_id" not in db.data[("movimientos", id)]


def test_foreign_subscription_evidence_rejected_before_writes(setup):
    db, _, proposal = setup
    proposal = subscription_proposal(db, proposal)
    db.data[("movimientos", "july")]["id_propietario"] = "other"
    expect_failure(setup, "not_found", proposal=proposal)


def test_subscription_with_later_link_cannot_be_deleted_on_revert(setup):
    db, service, proposal = setup
    result = service.apply_review("owner", "movement", subscription_proposal(db, proposal))
    sid = db.data[("movimientos", "movement")]["suscripcion_id"]
    db.put("movimientos", "later", {**db.data[("movimientos", "movement")], "suscripcion_id": sid})
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.revert_review("owner", result["review_id"])
    assert exc.value.code == "revert_conflict"
    assert db.data == before


def test_financial_edit_after_review_prevents_inverse_balance_effect(setup):
    db, service, proposal = setup
    result = service.apply_review("owner", "movement", proposal)
    db.data[("movimientos", "movement")]["importe"] = 20
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.revert_review("owner", result["review_id"])
    assert exc.value.code == "revert_conflict"
    assert db.data == before


def system_subscription_setup(setup):
    db, service, proposal = setup
    db.data[("review_configuration", "owner")]["category_huchas"] = {}
    db.put("huchas", "system", {"id_propietario": "owner", "es_suscripciones": True,
        "saldo_acumulado": 80, "objetivo": 10, "valor_aportacion": 10, "tipo_aportacion": "flat", "tope_objetivo": False})
    db.put("suscripciones", "existing-yearly", {"id_propietario": "owner", "importe": 120,
        "frecuencia": "anual", "hucha_id": "system", "activa": True})
    return db, service, subscription_proposal(db, proposal)


def test_new_subscription_updates_system_target_and_undo_restores_only_own_effects(setup):
    db, service, proposal = system_subscription_setup(setup)
    result = service.apply_review("owner", "movement", proposal)
    hucha = db.data[("huchas", "system")]
    assert hucha["objetivo"] == hucha["valor_aportacion"] == 22
    assert hucha["saldo_acumulado"] == 68
    hucha["saldo_acumulado"] += 7
    service.revert_review("owner", result["review_id"])
    assert hucha is not db.data[("huchas", "system")]
    restored = db.data[("huchas", "system")]
    assert restored["objetivo"] == restored["valor_aportacion"] == 10
    assert restored["saldo_acumulado"] == 87
    assert ("suscripciones", "existing-yearly") in db.data


def test_later_system_target_edit_blocks_subscription_undo(setup):
    db, service, proposal = system_subscription_setup(setup)
    result = service.apply_review("owner", "movement", proposal)
    db.data[("huchas", "system")]["objetivo"] = 99
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.revert_review("owner", result["review_id"])
    assert exc.value.code == "revert_conflict"
    assert db.data == before


def test_later_subscription_edit_blocks_undo(setup):
    db, service, proposal = setup
    result = service.apply_review("owner", "movement", subscription_proposal(db, proposal))
    sid = db.data[("movimientos", "movement")]["suscripcion_id"]
    subscription = db.data[("suscripciones", sid)]
    db.put("suscripciones", sid, {**subscription, "nombre": "User edited", "updated_at": db.tick()})
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.revert_review("owner", result["review_id"])
    assert exc.value.code == "revert_conflict"
    assert db.data == before


def seed_second_pending_job(db):
    db.put("movimientos", "second", {**db.data[("movimientos", "movement")]})
    db.data[("email_processing", "receipt")]["movement_ids"].append("second")
    db.put("review_jobs", document_id("owner", "second"), {"id_propietario": "owner", "movement_id": "second",
        "processing_id": "receipt", "state": "retryable_error", "attempts": 2, "next_attempt_at": db.tick()})


def test_grouped_question_and_answer_are_atomic_idempotent_and_reopen_jobs(setup):
    db, service, _ = setup
    seed_second_pending_job(db)
    recorded = service.record_question("owner", "question", ["movement", "second"], "Which category applies?")
    assert recorded["state"] == "open"
    for mid in ["movement", "second"]:
        job = db.data[("review_jobs", document_id("owner", mid))]
        assert job["state"] == "needs_user_input" and job["question_id"] == recorded["question_id"]
    before, writes = deepcopy(db.data), db.committed_writes
    assert service.record_question("owner", "question", ["movement", "second"], "Which category applies?") == recorded
    assert db.data == before and db.committed_writes == writes
    assert service.list_review_questions("owner")["items"][0]["id"] == recorded["question_id"]
    resolved = service.resolve_question("owner", recorded["question_id"], "Use food for both")
    assert resolved["state"] == "resolved"
    for mid in ["movement", "second"]:
        job = db.data[("review_jobs", document_id("owner", mid))]
        assert job["state"] == "pending" and job["attempts"] == 0
        assert job["user_answer"] == "Use food for both"
        assert "next_attempt_at" not in job
    before, writes = deepcopy(db.data), db.committed_writes
    assert service.resolve_question("owner", recorded["question_id"], "Use food for both") == resolved
    assert db.data == before and db.committed_writes == writes
    assert service.list_review_questions("owner")["items"] == []


def test_reused_question_or_different_answer_conflicts_without_writes(setup):
    db, service, _ = setup
    question = service.record_question("owner", "question", ["movement"], "Choose category")
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.record_question("owner", "question", ["movement"], "Changed question")
    assert exc.value.code == "question_conflict" and db.data == before
    service.resolve_question("owner", question["question_id"], "Food")
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.resolve_question("owner", question["question_id"], "Other")
    assert exc.value.code == "question_conflict" and db.data == before


def test_grouped_question_with_invalid_job_does_not_change_valid_job(setup):
    db, service, _ = setup
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.record_question("owner", "question", ["movement", "missing"], "Choose category")
    assert exc.value.code == "not_found"
    assert db.data == before


def test_defer_budget_survives_service_instances_and_escalates_after_three_attempts(setup):
    db, service, _ = setup
    for attempt in range(1, 4):
        # A scheduled run constructs a fresh service, without resetting storage.
        next_service = ReviewService(db, writes_enabled=True)
        next_service._atomic = db.atomic
        result = next_service.defer_review("owner", "movement", "waiting_evidence", "Receipt unavailable")
        assert result["attempts"] == attempt
        assert result["state"] == ("needs_user_input" if attempt == 3 else "waiting_evidence")
    job = db.data[("review_jobs", document_id("owner", "movement"))]
    assert job["attempts"] == 3 and job["last_error"] == "Receipt unavailable"
    assert job["next_attempt_at"].tzinfo is not None
    listed = service.list_review_questions("owner")
    assert len(listed["errors"]) == 1 and listed["errors"][0]["movement_id"] == "movement"


@pytest.mark.parametrize("debt", [{"deuda_pendiente": 5}, {"deuda_con": "other"}, {"subsanar_con": "other"}])
def test_revert_rejects_debt_introduced_after_review(debt, setup):
    db, service, proposal = setup
    result = service.apply_review("owner", "movement", proposal)
    db.data[("huchas", "food")].update(debt)
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.revert_review("owner", result["review_id"])
    assert exc.value.code == "revert_conflict"
    assert db.data == before


def test_manual_edits_override_automatic_fields_when_automatic_writes_disabled(setup):
    db, service, proposal = setup
    service.apply_review("owner", "movement", proposal)
    service.writes_enabled = False
    result = service.edit_movement("owner", "movement", name="User chosen name", category="custom-food")
    assert result["changes"]["concepto"] == "User chosen name"
    movement = db.data[("movimientos", "movement")]
    assert {"concepto", "categoria"} <= set(movement["review_protected_fields"])
    for field in ["concepto", "categoria"]:
        assert movement["field_provenance"][field]["source"] == "manual"
    assert movement["review_version"] == 2


def test_manual_category_mapping_reassigns_gross_amount_and_preserves_stats_and_compensations(setup):
    db, service, _ = setup
    movement = db.data[("movimientos", "movement")]
    movement["importe_compensado"] = 5
    movement["compensaciones"] = [{"movimiento_id": "income", "importe": 5}]
    db.put("stats", "owner", {"id_propietario": "owner", "total_ingresos": 100, "total_gastos": 12})
    stats = deepcopy(db.data[("stats", "owner")])
    service.edit_movement("owner", "movement", category="custom-food")
    updated = db.data[("movimientos", "movement")]
    assert updated["categoria"] == "custom-food" and updated["hucha_id"] == "food"
    assert updated["importe_compensado"] == 5
    assert updated["compensaciones"] == [{"movimiento_id": "income", "importe": 5}]
    assert db.data[("huchas", "main")]["saldo_acumulado"] == 112
    assert db.data[("huchas", "food")]["saldo_acumulado"] == 38
    assert db.data[("stats", "owner")] == stats
    assert updated["field_provenance"]["hucha_id"]["source"] == "automatic"
    assert "hucha_id" not in updated["review_protected_fields"]


def test_manually_selected_hucha_survives_later_category_mapping(setup):
    db, service, _ = setup
    service.edit_movement("owner", "movement", hucha_id="main")
    before_main = deepcopy(db.data[("huchas", "main")])
    before_food = deepcopy(db.data[("huchas", "food")])
    service.edit_movement("owner", "movement", category="custom-food")
    movement = db.data[("movimientos", "movement")]
    assert movement["categoria"] == "custom-food" and movement["hucha_id"] == "main"
    assert "hucha_id" in movement["review_protected_fields"]
    assert db.data[("huchas", "main")] == before_main
    assert db.data[("huchas", "food")] == before_food


def test_retry_manual_hucha_selection_does_not_repeat_financial_effect(setup):
    db, service, _ = setup
    service.edit_movement("owner", "movement", hucha_id="food")
    balances = {key: deepcopy(db.data[("huchas", key)]) for key in ["main", "food"]}
    service.edit_movement("owner", "movement", hucha_id="food")
    assert db.data[("movimientos", "movement")]["hucha_id"] == "food"
    assert "hucha_id" in db.data[("movimientos", "movement")]["review_protected_fields"]
    assert {key: db.data[("huchas", key)] for key in ["main", "food"]} == balances


@pytest.mark.parametrize("owner,category,code", [("other", "custom-food", "not_found"),
                                              ("owner", "missing-category", "invalid_category")])
def test_invalid_manual_owner_or_category_writes_nothing(owner, category, code, setup):
    db, service, _ = setup
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.edit_movement(owner, "movement", category=category)
    assert exc.value.code == code
    assert db.data == before and db.committed_writes == 0


def test_manual_edit_after_automatic_review_blocks_undo_even_when_value_is_same(setup):
    db, service, proposal = setup
    result = service.apply_review("owner", "movement", proposal)
    service.edit_movement("owner", "movement", name="Groceries")
    before = deepcopy(db.data)
    with pytest.raises(ReviewError) as exc:
        service.revert_review("owner", result["review_id"])
    assert exc.value.code == "revert_conflict"
    assert db.data == before
