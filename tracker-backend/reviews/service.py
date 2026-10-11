"""Owner-scoped Firestore operations for the second review of bank movements."""
import hashlib
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from .domain import ReviewError, active_hucha, cents, plan_review, reassignment


def document_id(owner, key):
    return hashlib.sha256(f"{owner}:{key}".encode()).hexdigest()


def checked_id(value):
    if not isinstance(value, str) or not value or len(value) > 200 or "/" in value:
        raise ReviewError("invalid_id", "Identificador no válido")
    return value


def serialize(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    return value


class ReviewService:
    def __init__(self, db, writes_enabled=False):
        self.db = db
        self.writes_enabled = writes_enabled

    def _atomic(self, operation):
        return firestore.transactional(operation)(self.db.transaction())

    def _ref(self, collection, key):
        return self.db.collection(collection).document(checked_id(key))

    def _read(self, collection, key, owner, transaction=None, optional=False):
        snap = self._ref(collection, key).get(transaction=transaction)
        if not snap.exists:
            if optional:
                return snap, {}
            raise ReviewError("not_found", "Documento no disponible")
        data = snap.to_dict()
        # Configuration is scoped by its document ID rather than an owner field.
        if (collection == "review_configuration" and key != owner) or (
            collection != "review_configuration" and data.get("id_propietario") != owner
        ):
            raise ReviewError("not_found", "Documento no disponible")
        return snap, data

    def _owned(self, collection, owner, transaction=None):
        return self.db.collection(collection).where(
            filter=FieldFilter("id_propietario", "==", owner)
        ).stream(transaction=transaction)

    @staticmethod
    def _version(snapshot):
        return snapshot.update_time.isoformat()

    def _job(self, owner, movement_id, transaction=None):
        job_id = document_id(owner, movement_id)
        _, job = self._read("review_jobs", job_id, owner, transaction)
        _, processing = self._read("email_processing", job["processing_id"], owner, transaction)
        if processing.get("state") != "completed" or movement_id not in processing.get("movement_ids", []):
            raise ReviewError("processing_incomplete", "El correo aún no está procesado")
        if job.get("movement_id") != movement_id:
            raise ReviewError("invalid_job", "Revisión incoherente")
        return job_id, job

    def list_pending_reviews(self, owner, limit=20, cursor=None):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
            raise ReviewError("invalid_limit", "El lote debe contener entre 1 y 50 casos")
        query = self.db.collection("review_jobs").where(filter=FieldFilter("id_propietario", "==", owner))
        query = query.where(filter=FieldFilter("state", "in", ["pending", "retryable_error", "waiting_evidence"]))
        query = query.order_by("__name__")
        if cursor:
            query = query.start_after({"__name__": self._ref("review_jobs", cursor)})
        # Bounded scan; caller must follow the cursor even when a page has no eligible cases.
        snapshots = list(query.limit(limit).stream())
        items = []
        now = datetime.now(timezone.utc)
        for snap in snapshots:
            job = snap.to_dict()
            if job.get("next_attempt_at") and job["next_attempt_at"] > now:
                continue
            try:
                self._job(owner, job["movement_id"])
            except ReviewError:
                continue
            items.append({"job_id": snap.id, **job})
        return serialize({"items": items, "next_cursor": snapshots[-1].id if len(snapshots) == limit else None})

    def get_movement_context(self, owner, movement_id):
        snapshot, movement = self._read("movimientos", movement_id, owner)
        job_id, job = self._job(owner, movement_id)
        email_id = movement.get("email_id") or movement.get("id_correo_origen")
        email = None
        if email_id:
            _, email = self._read("correos_historico", email_id, owner, optional=True)
        return serialize({"movement": {**movement, "id": movement_id}, "version": self._version(snapshot),
                          "job_id": job_id, "review": job, "email_id": email_id, "email": email})

    def get_finance_configuration(self, owner):
        _, config = self._read("review_configuration", owner, owner, optional=True)
        categories = json.loads((Path(__file__).parents[1] / "prompts/categories.json").read_text(encoding="utf-8"))
        custom = self.db.collection("categorias").document(owner).collection("items").stream()
        categories += [{**doc.to_dict(), "id": doc.id} for doc in custom]
        return serialize({"categories": categories, "configuration": config,
                          "huchas": [{**d.to_dict(), "id": d.id} for d in self._owned("huchas", owner)],
                          "subscriptions": [{**d.to_dict(), "id": d.id} for d in self._owned("suscripciones", owner)]})

    def search_related_movements(self, owner, start_date, end_date, limit=50, cursor=None):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ReviewError("invalid_limit", "Límite de búsqueda no válido")
        try:
            start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
            if start.tzinfo is None or end.tzinfo is None or start >= end:
                raise ValueError()
        except (AttributeError, ValueError, TypeError):
            raise ReviewError("invalid_dates", "Usa fechas ISO con zona horaria y un intervalo válido") from None
        query = self.db.collection("movimientos").where(filter=FieldFilter("id_propietario", "==", owner))
        query = query.where(filter=FieldFilter("fecha_operacion", ">=", start)).where(filter=FieldFilter("fecha_operacion", "<", end))
        query = query.order_by("fecha_operacion").order_by("__name__")
        if cursor:
            snapshot, _ = self._read("movimientos", cursor, owner)
            query = query.start_after(snapshot)
        docs = list(query.limit(limit).stream())
        items = []
        for snapshot in docs:
            data = snapshot.to_dict()
            if self._related_processing_complete(owner, data):
                items.append({**data, "id": snapshot.id, "version": self._version(snapshot)})
        return serialize({"items": items,
                          "next_cursor": docs[-1].id if len(docs) == limit else None})

    def _related_processing_complete(self, owner, movement, transaction=None):
        email_id = movement.get("email_id") or movement.get("id_correo_origen")
        if not email_id:
            return True  # Manual or legacy movements without a processing receipt.
        _, receipt = self._read("email_processing", document_id(owner, email_id), owner, transaction, optional=True)
        return not receipt or receipt.get("state") == "completed"

    def _prepare(self, owner, movement_id, proposal, transaction):
        snapshot, movement = self._read("movimientos", movement_id, owner, transaction)
        if proposal.get("expected_version") != self._version(snapshot):
            raise ReviewError("version_conflict", "El movimiento cambió; vuelve a consultar el contexto")
        job_id, job = self._job(owner, movement_id, transaction)
        if job.get("state") not in ["pending", "retryable_error", "waiting_evidence"]:
            raise ReviewError("review_closed", "La revisión ya está cerrada")
        _, config = self._read("review_configuration", owner, owner, transaction, optional=True)
        if proposal.get("configuration_revision") != config.get("revision", 0):
            raise ReviewError("configuration_conflict", "La configuración cambió")
        categories = json.loads((Path(__file__).parents[1] / "prompts/categories.json").read_text(encoding="utf-8"))
        custom = self.db.collection("categorias").document(owner).collection("items").stream(transaction=transaction)
        categories += [{**d.to_dict(), "id": d.id} for d in custom]
        huchas = {d.id: d.to_dict() for d in self._owned("huchas", owner, transaction)}
        subscriptions = {d.id: d.to_dict() for d in self._owned("suscripciones", owner, transaction)}
        evidence = {}
        evidence_versions = {}
        ids = (proposal.get("new_subscription") or {}).get("evidence_movement_ids", [])
        if not isinstance(ids, list) or len(ids) > 50:
            raise ReviewError("invalid_evidence", "Máximo 50 movimientos de evidencia")
        for key in ids:
            evidence_snapshot, evidence[key] = self._read("movimientos", key, owner, transaction)
            if not self._related_processing_complete(owner, evidence[key], transaction):
                raise ReviewError("processing_incomplete", "Un movimiento de evidencia aún está en procesamiento")
            evidence_versions[key] = self._version(evidence_snapshot)
        domain_proposal = {**proposal, "expected_version": movement.get("review_version", 0)}
        plan = plan_review(owner, {**movement, "id": movement_id}, domain_proposal, categories,
                           huchas, config, subscriptions, evidence)
        return plan, movement, huchas, subscriptions, evidence, evidence_versions, job_id

    def preview_review(self, owner, movement_id, proposal):
        return self._atomic(lambda tx: serialize(self._prepare(owner, movement_id, proposal, tx)[0]))

    def _require_writes(self):
        if not self.writes_enabled:
            raise ReviewError("writes_disabled", "Las escrituras de revisión están desactivadas")

    def apply_review(self, owner, movement_id, proposal):
        self._require_writes()
        operation_id = checked_id(proposal.get("operation_id"))
        audit_id = document_id(owner, operation_id)
        digest = hashlib.sha256(json.dumps({"movement_id": movement_id, "proposal": proposal}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

        def apply(tx):
            audit_ref = self._ref("review_history", audit_id)
            existing = audit_ref.get(transaction=tx)
            if existing.exists:
                old = existing.to_dict()
                if old.get("id_propietario") != owner or old.get("request_digest") != digest:
                    raise ReviewError("operation_conflict", "ID de operación reutilizado con otros datos")
                return old["result"]
            plan, movement, huchas, subscriptions, evidence, evidence_versions, job_id = self._prepare(owner, movement_id, proposal, tx)
            # All reads precede all writes. The transaction tracks versions of every effect.
            changes = dict(plan["movement_changes"])
            now = firestore.SERVER_TIMESTAMP
            updates = {}
            for key, change in plan.get("subscription_changes", {}).items():
                current = movement if key == movement_id else evidence[key]
                updates[key] = {"before": {f: current.get(f) for f in change}, "after": change}
            if movement_id not in updates:
                updates[movement_id] = {"before": {}, "after": {}}
            updates[movement_id]["before"].update({f: movement.get(f) for f in changes})
            updates[movement_id]["after"].update(changes)
            new_sub = plan.get("new_subscription")
            if new_sub and new_sub["id"] in subscriptions:
                raise ReviewError("subscription_conflict", "La suscripción ya existe")
            hucha_effects = {key: {"before": {f: huchas[key].get(f) for f in changes}, "after": changes}
                             for key, changes in plan.get("hucha_changes", {}).items()}
            for key in set(plan["hucha_deltas"]) | set(hucha_effects):
                update = {**hucha_effects.get(key, {}).get("after", {}), "updated_at": now}
                if key in plan["hucha_deltas"]:
                    balance = cents(huchas[key].get("saldo_acumulado", 0))
                    update["saldo_acumulado"] = (balance + plan["hucha_deltas"][key]) / 100
                tx.update(self._ref("huchas", key), update)
            if new_sub:
                tx.create(self._ref("suscripciones", new_sub["id"]), {**new_sub, "id_propietario": owner, "created_at": now, "updated_at": now})
            for key, effect in updates.items():
                current = movement if key == movement_id else evidence[key]
                changed = effect["after"]
                provenance = dict(current.get("field_provenance", {}))
                for field in changed:
                    provenance[field] = {"source": "automatic", "review_id": audit_id}
                tx.update(self._ref("movimientos", key), {**changed, "field_provenance": provenance,
                          "review_version": current.get("review_version", 0) + 1, "updated_at": now})
            result = {"review_id": audit_id, "movement_id": movement_id, "state": "reviewed", "changes": changes}
            tx.update(self._ref("review_jobs", job_id), {"state": "reviewed", "review_id": audit_id, "updated_at": now})
            tx.create(audit_ref, {"id_propietario": owner, "movement_id": movement_id, "operation_id": operation_id,
                      "request_digest": digest, "effects": updates, "hucha_deltas": plan["hucha_deltas"],
                      "hucha_effects": hucha_effects,
                      "financial_guard": {f: updates[movement_id]["after"].get(f, movement.get(f))
                          for f in ["importe", "tipo", "moneda", "hucha_id", "es_interno", "es_metalico", "transfer_id"]},
                      "created_subscription_id": new_sub["id"] if new_sub else None,
                      "subscription_evidence": proposal.get("new_subscription"),
                      "reason": proposal.get("reason", ""), "evidence": proposal.get("evidence", []),
                      "evidence_movement_versions": evidence_versions, "prompt_version": "daily-review-v1",
                      "created_at": now, "reverted": False, "result": result})
            return result
        return self._atomic(apply)

    def get_review_history(self, owner, limit=20, cursor=None):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
            raise ReviewError("invalid_limit", "Límite de historial no válido")
        query = self.db.collection("review_history").where(filter=FieldFilter("id_propietario", "==", owner)).order_by("created_at", direction=firestore.Query.DESCENDING)
        if cursor:
            snapshot, _ = self._read("review_history", cursor, owner)
            query = query.start_after(snapshot)
        docs = list(query.limit(limit).stream())
        return serialize({"items": [{**d.to_dict(), "id": d.id} for d in docs], "next_cursor": docs[-1].id if len(docs) == limit else None})

    def revert_review(self, owner, review_id):
        self._require_writes()

        def revert(tx):
            _, audit = self._read("review_history", review_id, owner, tx)
            if audit.get("reverted"):
                return {"review_id": review_id, "reverted": True}
            current = {}
            for key, effect in audit["effects"].items():
                _, movement = self._read("movimientos", key, owner, tx)
                for field, after in effect["after"].items():
                    provenance = movement.get("field_provenance", {}).get(field, {})
                    if movement.get(field) != after or provenance.get("review_id") != review_id or field in movement.get("review_protected_fields", []):
                        raise ReviewError("revert_conflict", "Hay cambios posteriores; no se puede deshacer automáticamente")
                current[key] = movement
            if audit["hucha_deltas"]:
                root_movement = current[audit["movement_id"]]
                if any(root_movement.get(f) != v for f, v in audit.get("financial_guard", {}).items()):
                    raise ReviewError("revert_conflict", "Los datos financieros del movimiento cambiaron")
            hucha_effects = audit.get("hucha_effects", {})
            huchas = {key: self._read("huchas", key, owner, tx)[1] for key in set(audit["hucha_deltas"]) | set(hucha_effects)}
            for key in audit["hucha_deltas"]:
                hucha = huchas[key]
                if cents(hucha.get("deuda_pendiente", 0) or 0) or hucha.get("deuda_con") or hucha.get("subsanar_con"):
                    raise ReviewError("revert_conflict", "La hucha tiene una deuda posterior; necesita revisión manual")
            for key, effect in hucha_effects.items():
                if any(huchas[key].get(f) != v for f, v in effect["after"].items()):
                    raise ReviewError("revert_conflict", "La configuración financiera de la hucha cambió")
            subscription_id = audit.get("created_subscription_id")
            if subscription_id:
                # Never delete a subscription after another review or manual edit uses it.
                _, subscription = self._read("suscripciones", subscription_id, owner, tx)
                linked = list(self.db.collection("movimientos").where(filter=FieldFilter("id_propietario", "==", owner)).where(filter=FieldFilter("suscripcion_id", "==", subscription_id)).stream(transaction=tx))
                if subscription.get("updated_at") != audit.get("created_at") or any(d.id not in current for d in linked):
                    raise ReviewError("revert_conflict", "La suscripción tiene cambios o vínculos posteriores")
            now = firestore.SERVER_TIMESTAMP
            for key, effect in audit["effects"].items():
                before = {f: firestore.DELETE_FIELD if v is None else v for f, v in effect["before"].items()}
                protected = list(set(current[key].get("review_protected_fields", []) + list(effect["after"])))
                provenance = dict(current[key].get("field_provenance", {}))
                for field in effect["after"]:
                    provenance[field] = {"source": "manual", "reverted_review_id": review_id}
                tx.update(self._ref("movimientos", key), {**before, "review_protected_fields": protected,
                          "field_provenance": provenance, "review_version": current[key].get("review_version", 0) + 1, "updated_at": now})
            for key in set(audit["hucha_deltas"]) | set(hucha_effects):
                effect = hucha_effects.get(key, {})
                update = {f: firestore.DELETE_FIELD if v is None else v for f, v in effect.get("before", {}).items()}
                update["updated_at"] = now
                if key in audit["hucha_deltas"]:
                    balance = cents(huchas[key].get("saldo_acumulado", 0))
                    update["saldo_acumulado"] = (balance - audit["hucha_deltas"][key]) / 100
                tx.update(self._ref("huchas", key), update)
            if subscription_id:
                tx.delete(self._ref("suscripciones", subscription_id))
            tx.update(self._ref("review_history", review_id), {"reverted": True, "reverted_at": now, "reverted_by": owner})
            return {"review_id": review_id, "reverted": True}
        return self._atomic(revert)

    def defer_review(self, owner, movement_id, state, reason):
        """Persist retries so a daily schedule cannot reset the retry budget."""
        self._require_writes()
        if state not in ["waiting_evidence", "retryable_error"] or not isinstance(reason, str) or not 1 <= len(reason) <= 1000:
            raise ReviewError("invalid_state", "Estado de reintento no válido")
        def defer(tx):
            job_id, job = self._job(owner, movement_id, tx)
            if job.get("state") == "reviewed":
                raise ReviewError("review_closed", "La revisión ya está cerrada")
            attempts = job.get("attempts", 0) + 1
            result = {"state": "needs_user_input" if attempts >= 3 else state, "attempts": attempts,
                      "last_error": reason, "next_attempt_at": datetime.now(timezone.utc) + timedelta(days=min(attempts, 3)),
                      "updated_at": firestore.SERVER_TIMESTAMP}
            tx.update(self._ref("review_jobs", job_id), result)
            return serialize({k: v for k, v in result.items() if k != "updated_at"})
        return self._atomic(defer)

    def record_question(self, owner, question_id, movement_ids, question):
        self._require_writes()
        if (not isinstance(question, str) or not 1 <= len(question) <= 2000 or not isinstance(movement_ids, list)
                or not 1 <= len(movement_ids) <= 20 or len(set(movement_ids)) != len(movement_ids)):
            raise ReviewError("invalid_question", "Pregunta no válida")
        key = document_id(owner, checked_id(question_id))
        def record(tx):
            ref = self._ref("review_questions", key)
            old = ref.get(transaction=tx)
            if old.exists:
                data = old.to_dict()
                if data.get("id_propietario") != owner or data.get("question") != question or data.get("movement_ids") != movement_ids:
                    raise ReviewError("question_conflict", "ID de pregunta reutilizado")
                return {"question_id": key, "state": data["state"]}
            jobs = [self._job(owner, checked_id(mid), tx) for mid in movement_ids]
            if any(job.get("state") == "reviewed" for _, job in jobs):
                raise ReviewError("review_closed", "Una revisión ya está cerrada")
            tx.create(ref, {"id_propietario": owner, "question": question, "movement_ids": movement_ids,
                           "state": "open", "created_at": firestore.SERVER_TIMESTAMP})
            for job_id, _ in jobs:
                tx.update(self._ref("review_jobs", job_id), {"state": "needs_user_input", "question_id": key, "updated_at": firestore.SERVER_TIMESTAMP})
            return {"question_id": key, "state": "open"}
        return self._atomic(record)

    def resolve_question(self, owner, question_id, answer):
        self._require_writes()
        if not isinstance(answer, str) or not 1 <= len(answer) <= 3000:
            raise ReviewError("invalid_answer", "Respuesta no válida")
        def resolve(tx):
            _, question = self._read("review_questions", question_id, owner, tx)
            if question.get("state") == "resolved":
                if question.get("answer") != answer:
                    raise ReviewError("question_conflict", "La pregunta ya tiene otra respuesta")
                return {"question_id": question_id, "state": "resolved"}
            jobs = [self._job(owner, mid, tx) for mid in question["movement_ids"]]
            for job_id, job in jobs:
                if job.get("question_id") == question_id and job.get("state") == "needs_user_input":
                    tx.update(self._ref("review_jobs", job_id), {"state": "pending", "attempts": 0, "next_attempt_at": firestore.DELETE_FIELD,
                              "user_answer": answer, "updated_at": firestore.SERVER_TIMESTAMP})
            tx.update(self._ref("review_questions", question_id), {"state": "resolved", "answer": answer, "resolved_at": firestore.SERVER_TIMESTAMP})
            return {"question_id": question_id, "state": "resolved"}
        return self._atomic(resolve)

    def list_review_questions(self, owner):
        questions = self.db.collection("review_questions").where(filter=FieldFilter("id_propietario", "==", owner)).where(filter=FieldFilter("state", "==", "open")).limit(50).stream()
        jobs = self.db.collection("review_jobs").where(filter=FieldFilter("id_propietario", "==", owner)).where(filter=FieldFilter("state", "==", "needs_user_input")).limit(50).stream()
        return serialize({"items": [{**d.to_dict(), "id": d.id} for d in questions],
                          "errors": [{**d.to_dict(), "id": d.id} for d in jobs if not d.to_dict().get("question_id")]})

    def edit_movement(self, owner, movement_id, name=None, category=None, hucha_id=None):
        """Human edits share the same balance planner as automatic reviews.

        These authenticated web operations remain available when automatic
        writes are disabled. The MCP does not expose this manual-edit bypass.
        """
        def edit(tx):
            _, movement = self._read("movimientos", movement_id, owner, tx)
            _, config = self._read("review_configuration", owner, owner, tx, optional=True)
            huchas = {d.id: d.to_dict() for d in self._owned("huchas", owner, tx)}
            changes = {}
            protected = set(movement.get("review_protected_fields", []))
            if name is not None:
                if not isinstance(name, str) or not name.strip() or len(name) > 200:
                    raise ReviewError("invalid_name", "Nombre no válido")
                changes["concepto"] = name.strip()
                protected.add("concepto")
            if category is not None:
                categories = json.loads((Path(__file__).parents[1] / "prompts/categories.json").read_text(encoding="utf-8"))
                custom = self.db.collection("categorias").document(owner).collection("items").stream(transaction=tx)
                categories += [{**d.to_dict(), "id": d.id} for d in custom]
                if not any(c["id"] == category and c.get("tipo") in [movement["tipo"], "ambos"] for c in categories):
                    raise ReviewError("invalid_category", "Categoría no válida")
                changes["categoria"] = category
                protected.add("categoria")
            target = movement.get("hucha_id")
            if hucha_id is not None:
                target = checked_id(hucha_id)
                protected.add("hucha_id")
            elif category is not None and "hucha_id" not in protected and movement.get("tipo") == "gasto":
                target = config.get("category_huchas", {}).get(category) or target
            deltas = {}
            if target != movement.get("hucha_id"):
                if movement["tipo"] != "gasto" or movement.get("es_interno") or movement.get("es_metalico") or movement.get("transfer_id"):
                    raise ReviewError("ineligible_movement", "Este movimiento no admite reasignación de hucha")
                active_hucha(owner, target, huchas)
                deltas = reassignment(owner, movement, target, huchas)
                changes["hucha_id"] = target
            if not changes and hucha_id is None:
                raise ReviewError("invalid_edit", "No hay campos para editar")
            provenance = dict(movement.get("field_provenance", {}))
            for field in changes:
                provenance[field] = {"source": "manual" if field in protected else "automatic", "source_detail": "user_category_mapping"}
            now = firestore.SERVER_TIMESTAMP
            for key, delta in deltas.items():
                tx.update(self._ref("huchas", key), {"saldo_acumulado": (cents(huchas[key].get("saldo_acumulado", 0)) + delta) / 100, "updated_at": now})
            tx.update(self._ref("movimientos", movement_id), {**changes, "review_protected_fields": sorted(protected),
                      "field_provenance": provenance, "review_version": movement.get("review_version", 0) + 1, "updated_at": now})
            return {"movement_id": movement_id, "changes": changes}
        return self._atomic(edit)
