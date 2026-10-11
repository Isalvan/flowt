"""Durable ingestion receipts and the handoff to automatic review.

No email bodies are stored here; their retention remains in correos_historico.
If persistence succeeded but branch bookkeeping was interrupted, ingestion
salvages the known IDs and sends the original email to initial manual review.
It never reruns financial extraction, whose indexes may change between calls.
Only explicit manual approval can append verified IDs after completion.
"""
import hashlib
import logging
import os

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger(__name__)


def review_enabled():
    return os.getenv("FLOWT_REVIEW_ENABLED", "false").lower() in {"true", "1", "yes"}


def scoped_id(owner_id, source_id):
    return hashlib.sha256(f"{owner_id}:{source_id}".encode()).hexdigest()


def processing_ref(db, owner_id, email_id):
    return db.collection("email_processing").document(scoped_id(owner_id, email_id))


def read_processing(db, owner_id, email_id, transaction=None):
    snapshot = processing_ref(db, owner_id, email_id).get(transaction=transaction)
    data = snapshot.to_dict() if snapshot.exists else {}
    if data and data.get("id_propietario") != owner_id:
        raise ValueError("Processing owner mismatch")
    return data or {}


def record_movements(transaction, db, owner_id, email_id, previous, movement_ids):
    """Called in the SAME transaction as bank movements, after all reads."""
    ids = list(dict.fromkeys(previous.get("movement_ids", []) + list(movement_ids)))
    if previous.get("branches_resolved") and ids != previous.get("movement_ids", []):
        raise ValueError("Cannot append movements after email processing is closed")
    transaction.set(processing_ref(db, owner_id, email_id), {
        "id_propietario": owner_id,
        "email_id": email_id,
        "movement_ids": ids,
        "state": previous.get("state", "processing"),
        "updated_at": firestore.SERVER_TIMESTAMP,
        **({"created_at": firestore.SERVER_TIMESTAMP} if not previous else {}),
    }, merge=True)


def record_resolved_branches(db, owner_id, email_id, pending_initial_review):
    processing_ref(db, owner_id, email_id).set({
        "id_propietario": owner_id,
        "email_id": email_id,
        "branches_resolved": True,
        "pending_initial_review": pending_initial_review,
        "updated_at": firestore.SERVER_TIMESTAMP,
    }, merge=True)


@firestore.transactional
def complete_processing(transaction, db, owner_id, email_id):
    """Publish jobs and completion together; existing jobs keep their state."""
    receipt = read_processing(db, owner_id, email_id, transaction)
    if not receipt.get("branches_resolved"):
        raise ValueError("Email still has unresolved ingestion branches")
    movement_ids = receipt.get("movement_ids", [])
    movements = []
    jobs = []
    for movement_id in movement_ids:
        movement = db.collection("movimientos").document(movement_id).get(transaction=transaction)
        if not movement.exists:
            raise ValueError("Processing references a missing movement")
        data = movement.to_dict()
        if data.get("id_propietario") != owner_id:
            raise ValueError("Movement owner mismatch")
        if (data.get("email_id") or data.get("id_correo_origen")) != email_id:
            raise ValueError("Movement email mismatch")
        movements.append(data)
        ref = db.collection("review_jobs").document(scoped_id(owner_id, movement_id))
        jobs.append((ref, ref.get(transaction=transaction)))
    for movement_id, movement, (ref, snapshot) in zip(movement_ids, movements, jobs):
        if movement.get("es_interno") or movement.get("es_metalico") or movement.get("transfer_id") or snapshot.exists:
            continue
        transaction.set(ref, {
            "id_propietario": owner_id,
            "movement_id": movement_id,
            "email_id": email_id,
            "processing_id": scoped_id(owner_id, email_id),
            "state": "pending",
            "attempts": 0,
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
    transaction.set(processing_ref(db, owner_id, email_id), {
        "state": "completed", "completed_at": firestore.SERVER_TIMESTAMP,
    }, merge=True)
    return movement_ids


@firestore.transactional
def publish_approved_movements(transaction, db, owner_id, email_id, movement_ids):
    """Explicit initial-review approval may append IDs to a closed receipt.

    Call after the manual approval has persisted its financial movements. This
    validates every referenced movement and atomically expands the durable
    receipt and publishes jobs; parser retries cannot use this exception.
    Approval does not reset jobs already completed by the second review.
    """
    previous = read_processing(db, owner_id, email_id, transaction)
    if previous.get("state") != "completed" or not previous.get("branches_resolved"):
        raise ValueError("Initial review approval requires completed email processing")
    if not isinstance(movement_ids, list) or not movement_ids or len(movement_ids) > 50:
        raise ValueError("Approval requires between one and fifty movement IDs")
    if any(not isinstance(mid, str) or not mid or "/" in mid for mid in movement_ids):
        raise ValueError("Invalid approved movement ID")
    ids = list(dict.fromkeys(previous.get("movement_ids", []) + movement_ids))
    jobs = []
    for mid in ids:
        snapshot = db.collection("movimientos").document(mid).get(transaction=transaction)
        movement = snapshot.to_dict() if snapshot.exists else {}
        if movement.get("id_propietario") != owner_id:
            raise ValueError("Approved movement owner mismatch or missing movement")
        if (movement.get("email_id") or movement.get("id_correo_origen")) != email_id:
            raise ValueError("Approved movement email mismatch")
        ref = db.collection("review_jobs").document(scoped_id(owner_id, mid))
        job = ref.get(transaction=transaction)
        jobs.append((mid, movement, ref, job))
    for mid, movement, ref, snapshot in jobs:
        if movement.get("es_interno") or movement.get("es_metalico") or movement.get("transfer_id") or snapshot.exists:
            continue
        transaction.set(ref, {
            "id_propietario": owner_id, "movement_id": mid, "email_id": email_id,
            "processing_id": scoped_id(owner_id, email_id), "state": "pending", "attempts": 0,
            "created_at": firestore.SERVER_TIMESTAMP, "updated_at": firestore.SERVER_TIMESTAMP,
        })
    transaction.set(processing_ref(db, owner_id, email_id), {
        "movement_ids": ids, "pending_initial_review": False,
        "updated_at": firestore.SERVER_TIMESTAMP,
    }, merge=True)
    return ids


def _consume_approved_handoff(transaction, db, owner_id, handoff_id):
    ref = db.collection("review_handoffs").document(handoff_id)
    snapshot = ref.get(transaction=transaction)
    if not snapshot.exists:
        return False
    handoff = snapshot.to_dict()
    if handoff.get("id_propietario") != owner_id:
        raise ValueError("Handoff owner mismatch")
    movement_id = handoff.get("movement_id")
    email_id = handoff.get("email_id")
    if (not isinstance(movement_id, str) or not movement_id or "/" in movement_id
            or not isinstance(email_id, str) or not email_id or "/" in email_id):
        raise ValueError("Invalid handoff references")
    # Sharing the transaction keeps publication and deletion atomic; failures
    # retain the handoff so a future ingestion run can retry safely.
    publish_approved_movements.to_wrap(transaction, db, owner_id, email_id, [movement_id])
    transaction.delete(ref)
    return True


def drain_approved_handoffs(db, owner_id):
    """Consume at most fifty owner-scoped manual approval handoffs per run."""
    docs = db.collection("review_handoffs").where(
        filter=FieldFilter("id_propietario", "==", owner_id)
    ).limit(50).stream()
    consumed = 0
    for snapshot in docs:
        try:
            if firestore.transactional(_consume_approved_handoff)(
                db.transaction(), db, owner_id, snapshot.id,
            ):
                consumed += 1
        except Exception:
            # Log the opaque handoff ID only: errors may carry sensitive data.
            logger.warning("Approved review handoff %s retained for retry", snapshot.id)
    return consumed
