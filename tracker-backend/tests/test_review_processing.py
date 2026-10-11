from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import main
from reviews import processing


class MemoryDB:
    def __init__(self):
        self.data = {}
        self.writes = []

    def collection(self, name):
        return MemoryQuery(self, name)

    def set(self, ref, data, merge=False):
        self.writes.append((ref.key, deepcopy(data)))
        self.data[ref.key] = {**(self.data.get(ref.key, {}) if merge else {}), **data}

    def transaction(self):
        return self

    def delete(self, ref):
        self.data.pop(ref.key, None)


class MemoryQuery:
    def __init__(self, db, collection, owner=None, cap=50):
        self.db, self.collection, self.owner, self.cap = db, collection, owner, cap

    def document(self, id):
        return Reference(self.db, (self.collection, id))

    def where(self, *, filter):
        return MemoryQuery(self.db, self.collection, filter.value, self.cap)

    def limit(self, cap):
        return MemoryQuery(self.db, self.collection, self.owner, cap)

    def stream(self):
        return [self.document(id).get() for (collection, id), value in self.db.data.items()
                if collection == self.collection and value.get("id_propietario") == self.owner][:self.cap]


class Reference:
    def __init__(self, db, key):
        self.db, self.key = db, key

    def get(self, transaction=None):
        data = self.db.data.get(self.key)
        return SimpleNamespace(id=self.key[1], exists=data is not None, to_dict=lambda: deepcopy(data))

    def set(self, data, merge=False):
        self.db.set(self, data, merge)


def complete(db, owner="owner", email="email"):
    return processing.complete_processing.to_wrap(db, db, owner, email)


def seed(db, internal=False):
    db.data[("movimientos", "movement")] = {
        "id_propietario": "owner", "email_id": "email", "es_interno": internal,
    }
    processing.record_movements(db, db, "owner", "email", {}, ["movement"])


def test_receipts_are_owner_scoped_and_have_no_body_or_ttl():
    db = MemoryDB()
    seed(db)
    receipt = processing.read_processing(db, "owner", "email")
    assert receipt["movement_ids"] == ["movement"]
    assert processing.scoped_id("owner", "email") != processing.scoped_id("other", "email")
    assert "cuerpo" not in receipt and "expires_at" not in receipt
    assert not any(key[0] == "review_jobs" for key in db.data)


def test_unresolved_email_cannot_publish_jobs():
    db = MemoryDB()
    seed(db)
    before = deepcopy(db.data)
    with pytest.raises(ValueError, match="unresolved"):
        complete(db)
    assert db.data == before


def test_completed_retry_preserves_job_state_and_unique_movement_ids():
    db = MemoryDB()
    seed(db)
    previous = processing.read_processing(db, "owner", "email")
    processing.record_movements(db, db, "owner", "email", previous, ["movement"])
    processing.record_resolved_branches(db, "owner", "email", True)
    complete(db)
    job_key = ("review_jobs", processing.scoped_id("owner", "movement"))
    db.data[job_key]["state"] = "reviewed"
    complete(db)
    assert db.data[job_key]["state"] == "reviewed"
    receipt = processing.read_processing(db, "owner", "email")
    assert receipt["state"] == "completed"
    assert receipt["movement_ids"] == ["movement"]
    assert receipt["pending_initial_review"] is True


@pytest.mark.parametrize("damage", ["missing", "owner", "email"])
def test_invalid_reference_prevents_any_completion_writes(damage):
    db = MemoryDB()
    seed(db)
    processing.record_resolved_branches(db, "owner", "email", False)
    if damage == "missing":
        del db.data[("movimientos", "movement")]
    else:
        db.data[("movimientos", "movement")]["id_propietario" if damage == "owner" else "email_id"] = "other"
    before = deepcopy(db.data)
    with pytest.raises(ValueError):
        complete(db)
    assert db.data == before


def test_internal_movement_does_not_get_a_review_job():
    db = MemoryDB()
    seed(db, internal=True)
    processing.record_resolved_branches(db, "owner", "email", False)
    complete(db)
    assert not any(key[0] == "review_jobs" for key in db.data)


def test_feature_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("FLOWT_REVIEW_ENABLED", raising=False)
    assert processing.review_enabled() is False


def test_history_failure_keeps_email_unread_then_recovers():
    db = MemoryDB()
    seed(db)
    processing.record_resolved_branches(db, "owner", "email", False)
    email = {"id": "email", "body": "Bank notification", "date_sent": "date"}
    original_set = db.set

    def failing_set(ref, data, merge=False):
        if ref.key[0] == "correos_historico":
            raise RuntimeError("history unavailable")
        original_set(ref, data, merge)

    with patch.object(main, "db", db), patch.object(main, "UID_PROPIETARIO", "owner"), \
         patch.object(main, "mark_email_as_read") as mark, \
         patch.object(main, "complete_processing", side_effect=lambda tx, db, owner, email: complete(db, owner, email)):
        db.set = failing_set
        with pytest.raises(RuntimeError):
            main.finish_review_handoff(email, ["movement"])
        mark.assert_not_called()
        assert processing.read_processing(db, "owner", "email")["state"] == "processing"
        db.set = original_set
        mark.return_value = False
        main.finish_review_handoff(email, ["movement"])
        assert processing.read_processing(db, "owner", "email")["state"] == "completed"
        # Gmail failing is harmless after the durable completion.
        main.finish_review_handoff(email, ["movement"])
        assert len([key for key in db.data if key[0] == "review_jobs"]) == 1


def test_partial_invalid_email_records_pending_branch_before_completion(monkeypatch):
    monkeypatch.setenv("FLOWT_REVIEW_ENABLED", "true")
    db = MemoryDB()
    events = []
    email = {"id": "email", "from": "bank@example.com", "body": "Charge 10 EUR", "date_sent": "Sun, 04 Oct 2026 10:00:00 +0000"}
    valid = {"tipo": "gasto", "importe": 10, "fecha": "2026-10-04", "confianza": "alta"}

    def save_movements(tx, movements, owner, email_id=None):
        events.append("movements")
        return ["movement"]

    with patch.object(main, "db", db), patch.object(main, "UID_PROPIETARIO", "owner"), \
         patch.object(main, "ALLOWED_BANK_SENDERS", frozenset()), \
         patch.object(main, "process_expired_subscriptions"), \
         patch.object(main, "get_unread_emails_from_bank", return_value=[email]), \
         patch.object(main, "extract_with_gemini", return_value=[valid, {}]), \
         patch.object(main, "process_email_movements_transaction", side_effect=save_movements), \
         patch.object(main, "save_to_pending_review", side_effect=lambda *args: events.append("pending") or True), \
         patch.object(main, "finish_review_handoff", side_effect=lambda *args: events.append("completed")):
        main.process_emails()
    assert events == ["movements", "pending", "completed"]
    assert processing.read_processing(db, "owner", "email")["branches_resolved"] is True


def test_movement_retry_repairs_receipt_without_financial_effects(monkeypatch):
    monkeypatch.setenv("FLOWT_REVIEW_ENABLED", "true")
    db, tx = MagicMock(), MagicMock()
    db.collection.return_value.document.return_value.get.return_value.exists = False
    db.collection.return_value.where.return_value.order_by.return_value.stream.return_value = []
    db.collection.return_value.where.return_value.where.return_value.stream.return_value = []
    snapshot = SimpleNamespace(
        id="existing", exists=True,
        to_dict=lambda: {"id_propietario": "owner", "email_id": "email"},
    )
    db.get_all.return_value = [snapshot]
    with patch.object(main, "db", db):
        result = main.process_email_movements_transaction.to_wrap(
            tx, [{"doc_id": "existing", "movimiento": {}}], "owner", email_id="email",
        )
    assert result == ["existing"]
    tx.update.assert_not_called()
    assert tx.set.call_count == 1
    assert tx.set.call_args.args[1]["movement_ids"] == ["existing"]
    assert tx.set.call_args.args[1]["state"] == "processing"


def test_new_movement_initializes_original_and_version(monkeypatch):
    monkeypatch.setenv("FLOWT_REVIEW_ENABLED", "true")
    db, tx = MagicMock(), MagicMock()
    db.collection.return_value.document.return_value.get.return_value.exists = False
    db.collection.return_value.where.return_value.order_by.return_value.stream.return_value = []
    db.collection.return_value.where.return_value.where.return_value.stream.return_value = []
    db.get_all.return_value = []
    movement = {"tipo": "gasto", "importe": 10, "concepto": "Original extraction"}
    with patch.object(main, "db", db):
        main.process_email_movements_transaction.to_wrap(
            tx, [{"doc_id": "new", "movimiento": movement}], "owner", email_id="email",
        )
    assert movement["original_concept"] == "Original extraction"
    assert movement["original_concept_source"] == "initial_extraction"
    assert movement["review_version"] == 0
    assert movement["id_correo_origen"] == "email"


def test_interrupted_persistence_salvages_known_ids_without_reparsing(monkeypatch):
    monkeypatch.setenv("FLOWT_REVIEW_ENABLED", "true")
    db = MemoryDB()
    seed(db)
    email = {"id": "email", "from": "bank@example.com", "body": "Charge 10 EUR", "date_sent": "Sun, 04 Oct 2026 10:00:00 +0000"}
    with patch.object(main, "db", db), patch.object(main, "UID_PROPIETARIO", "owner"), \
         patch.object(main, "ALLOWED_BANK_SENDERS", frozenset()), \
         patch.object(main, "process_expired_subscriptions"), \
         patch.object(main, "get_unread_emails_from_bank", return_value=[email]), \
         patch.object(main, "extract_with_gemini", return_value=[{}, {}, {}]) as parser, \
         patch.object(main, "save_to_pending_review", return_value=True) as pending, \
         patch.object(main, "finish_review_handoff") as finish:
        main.process_emails()
    parser.assert_not_called()
    pending.assert_called_once()
    finish.assert_called_once_with(email, ["movement"])
    receipt = processing.read_processing(db, "owner", "email")
    assert receipt["branches_resolved"] and receipt["pending_initial_review"]
    assert receipt["movement_ids"] == ["movement"]


def test_approved_initial_review_appends_closed_receipt_and_preserves_jobs():
    db = MemoryDB()
    seed(db)
    processing.record_resolved_branches(db, "owner", "email", True)
    complete(db)
    job_key = ("review_jobs", processing.scoped_id("owner", "movement"))
    db.data[job_key]["state"] = "reviewed"
    db.data[("movimientos", "approved")] = {
        "id_propietario": "owner", "id_correo_origen": "email", "tipo": "gasto",
    }
    result = processing.publish_approved_movements.to_wrap(db, db, "owner", "email", ["approved"])
    assert result == ["movement", "approved"]
    receipt = processing.read_processing(db, "owner", "email")
    assert receipt["state"] == "completed" and receipt["pending_initial_review"] is False
    assert db.data[job_key]["state"] == "reviewed"
    assert db.data[("review_jobs", processing.scoped_id("owner", "approved"))]["state"] == "pending"


@pytest.mark.parametrize("excluded", [{"es_metalico": True}, {"transfer_id": "transfer"}, {"es_interno": True}])
def test_cash_internal_and_transfers_not_published_from_completion_or_approval(excluded):
    db = MemoryDB()
    seed(db)
    db.data[("movimientos", "movement")].update(excluded)
    processing.record_resolved_branches(db, "owner", "email", True)
    complete(db)
    db.data[("movimientos", "approved")] = {"id_propietario": "owner", "email_id": "email", **excluded}
    processing.publish_approved_movements.to_wrap(db, db, "owner", "email", ["approved"])
    assert not any(key[0] == "review_jobs" for key in db.data)


@pytest.mark.parametrize("invalid", [{"id_propietario": "other", "email_id": "email"},
                                    {"id_propietario": "owner", "email_id": "other"}, None])
def test_approval_validation_fails_without_receipt_or_job_writes(invalid):
    db = MemoryDB()
    seed(db)
    processing.record_resolved_branches(db, "owner", "email", True)
    complete(db)
    if invalid is not None:
        db.data[("movimientos", "approved")] = invalid
    before = deepcopy(db.data)
    with pytest.raises(ValueError):
        processing.publish_approved_movements.to_wrap(db, db, "owner", "email", ["approved"])
    assert db.data == before


def test_drain_manual_handoff_publishes_and_deletes_atomically(monkeypatch):
    db = MemoryDB()
    seed(db)
    processing.record_resolved_branches(db, "owner", "email", True)
    complete(db)
    db.data[("movimientos", "approved")] = {"id_propietario": "owner", "id_correo_origen": "email"}
    db.data[("review_handoffs", "approved")] = {"id_propietario": "owner", "movement_id": "approved", "email_id": "email"}
    monkeypatch.setattr(processing.firestore, "transactional", lambda fn: fn)
    assert processing.drain_approved_handoffs(db, "owner") == 1
    assert ("review_handoffs", "approved") not in db.data
    job_key = ("review_jobs", processing.scoped_id("owner", "approved"))
    assert db.data[job_key]["state"] == "pending"
    assert processing.drain_approved_handoffs(db, "owner") == 0
    # A duplicate handoff preserves a review already completed.
    db.data[job_key]["state"] = "reviewed"
    db.data[("review_handoffs", "approved")] = {"id_propietario": "owner", "movement_id": "approved", "email_id": "email"}
    assert processing.drain_approved_handoffs(db, "owner") == 1
    assert db.data[job_key]["state"] == "reviewed"


def test_invalid_handoff_survives_and_another_owners_handoff_is_untouched(monkeypatch):
    db = MemoryDB()
    seed(db)
    processing.record_resolved_branches(db, "owner", "email", True)
    complete(db)
    db.data[("review_handoffs", "missing")] = {"id_propietario": "owner", "movement_id": "missing", "email_id": "email"}
    db.data[("review_handoffs", "foreign")] = {"id_propietario": "other", "movement_id": "movement", "email_id": "email"}
    before = deepcopy(db.data)
    monkeypatch.setattr(processing.firestore, "transactional", lambda fn: fn)
    assert processing.drain_approved_handoffs(db, "owner") == 0
    assert db.data == before
