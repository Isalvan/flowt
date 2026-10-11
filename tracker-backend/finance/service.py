"""Owner-scoped finance operations behind the MCP tools.

They mirror what the signed-in user can do in the web app. Every write runs in
one Firestore transaction with all reads first, and money moves in whole cents.
The owner always comes from the verified credential, never from tool arguments.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from uuid import uuid4

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from reviews.domain import ReviewError, cents, fail
from reviews.service import ReviewService, checked_id, document_id, serialize
from . import domain as d

CATALOG = Path(__file__).parents[1] / "prompts/categories.json"
NOW = firestore.SERVER_TIMESTAMP
DELETE = firestore.DELETE_FIELD
UNSET = object()
SCAN_LIMIT = 500
SUMMARY_LIMIT = 5000


def write(method):
    """Expose a transaction body as a tool that takes an optional idempotency key."""
    @wraps(method)
    def tool(self, owner, operation_id=None, **arguments):
        return self._write(owner, method.__name__, arguments, operation_id,
                           lambda tx: method(self, tx, owner, **arguments))
    return tool


def public(doc_id, data):
    """A stored document as shown to the client: no owner, no pending server timestamps."""
    return {"id": doc_id, **{k: v for k, v in data.items() if k != "id_propietario" and v is not NOW}}


class FinanceService:
    def __init__(self, db, reviews=None):
        self.db = db
        self.reviews = reviews or ReviewService(db)

    def _atomic(self, operation):
        return firestore.transactional(operation)(self.db.transaction())

    def _write(self, owner, name, arguments, operation_id, body):
        if operation_id is None:
            return self._atomic(lambda tx: serialize(body(tx)))
        key = document_id(owner, "mcp:" + checked_id(operation_id))
        digest = hashlib.sha256(json.dumps([name, arguments], sort_keys=True, ensure_ascii=False).encode()).hexdigest()

        def run(tx):
            ref = self.db.collection("mcp_operations").document(key)
            previous = ref.get(transaction=tx)
            if previous.exists:
                stored = previous.to_dict()
                if stored.get("id_propietario") != owner or stored.get("request_digest") != digest:
                    raise ReviewError("operation_conflict", "ID de operación reutilizado con otros datos")
                return stored["result"]
            result = serialize(body(tx))
            tx.create(ref, {"id_propietario": owner, "tool": name, "request_digest": digest, "result": result,
                            "created_at": NOW, "expires_at": datetime.now(timezone.utc) + timedelta(days=30)})
            return result
        return self._atomic(run)

    # --- Shared reads -------------------------------------------------------

    def _ref(self, collection, key):
        return self.db.collection(collection).document(checked_id(key))

    def _doc(self, collection, key, owner, tx=None):
        ref = self._ref(collection, key)
        snapshot = ref.get(transaction=tx)
        data = snapshot.to_dict() if snapshot.exists else None
        if not data or data.get("id_propietario") != owner:
            raise ReviewError("not_found", "Documento no disponible")
        return ref, data

    def _owned(self, collection, owner, tx=None):
        query = self.db.collection(collection).where(filter=FieldFilter("id_propietario", "==", owner))
        return {snapshot.id: snapshot.to_dict() for snapshot in query.stream(transaction=tx)}

    def _categories(self, owner, tx=None):
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        custom = self.db.collection("categorias").document(owner).collection("items").stream(transaction=tx)
        return catalog + [{"id": s.id, "label": s.to_dict().get("label"), "tipo": s.to_dict().get("tipo")} for s in custom]

    def _require_category(self, owner, category, tipo, tx=None):
        if not any(c["id"] == category and c.get("tipo") in (tipo, "ambos") for c in self._categories(owner, tx)):
            fail("invalid_category", "Categoría no válida para este tipo de movimiento")

    def _config(self, owner, tx=None):
        snapshot = self.db.collection("review_configuration").document(owner).get(transaction=tx)
        return snapshot.to_dict() if snapshot.exists else {}

    def _stats(self, owner, tx=None):
        snapshot = self.db.collection("stats").document(owner).get(transaction=tx)
        return snapshot.to_dict() if snapshot.exists else {}

    @staticmethod
    def _usable(hucha_id, huchas):
        hucha = huchas.get(checked_id(hucha_id))
        if not hucha or not d.is_active(hucha):
            fail("invalid_hucha", "La cartera no existe o está archivada")
        return hucha

    def _movement_query(self, owner, start_date=None, end_date=None):
        query = self.db.collection("movimientos").where(filter=FieldFilter("id_propietario", "==", owner))
        start = d.parse_moment(start_date) if start_date else None
        end = d.parse_moment(end_date) if end_date else None
        if start and end and start >= end:
            fail("invalid_dates", "El intervalo de fechas está vacío")
        if start:
            query = query.where(filter=FieldFilter("fecha_operacion", ">=", start))
        if end:
            query = query.where(filter=FieldFilter("fecha_operacion", "<", end))
        return query.order_by("fecha_operacion", direction=firestore.Query.DESCENDING)

    # --- Shared writes ------------------------------------------------------

    def _apply(self, tx, huchas, deltas, extra=None, created=None):
        """Persist balance deltas (cents) plus extra wallet fields; returns before/after per wallet."""
        extra, created = extra or {}, created or {}
        summary = {}
        for hid in sorted(set(deltas) | set(extra) | set(created)):
            current = created.get(hid) or huchas[hid]
            before = cents(current.get("saldo_acumulado") or 0)
            after = before + deltas.get(hid, 0)
            fields = {**extra.get(hid, {}), "updated_at": NOW}
            if after != before:
                fields["saldo_acumulado"] = d.euros(after)
            if hid in created:
                tx.set(self._ref("huchas", hid), {**created[hid], **{k: v for k, v in fields.items() if v is not DELETE}})
            elif len(fields) > 1:
                tx.update(self._ref("huchas", hid), fields)
            if after != before or hid in created:
                summary[hid] = {"nombre": current.get("nombre"), "saldo_antes": d.euros(before), "saldo_despues": d.euros(after)}
        return summary

    @staticmethod
    def _debt_fields(huchas, debts, restore=False):
        """Wallet fields for debt repaid by an income, or owed again when that income is undone."""
        fields = {}
        for hid, debt in debts.items():
            owed = cents(huchas[hid].get("deuda_pendiente") or 0) + (debt["importe"] if restore else -debt["importe"])
            fields[hid] = {"deuda_pendiente": d.euros(max(owed, 0)), "deuda_con": debt["con"] if owed > 0 else DELETE}
        return fields

    def _bump_stats(self, tx, owner, stats, ingresos=0, gastos=0):
        if not ingresos and not gastos:
            return
        tx.set(self.db.collection("stats").document(owner), {
            "total_ingresos": d.euros(max(0, cents(stats.get("total_ingresos") or 0) + ingresos)),
            "total_gastos": d.euros(max(0, cents(stats.get("total_gastos") or 0) + gastos)),
            "updated_at": NOW,
        }, merge=True)

    def _cash_hucha(self, owner, huchas):
        """The cash wallet, provisioned on first use like the web does."""
        for hid, hucha in d.ordered(huchas):
            name = (hucha.get("nombre") or "").lower()
            if hucha.get("es_metalico") or "metalico" in name or "efectivo" in name:
                return hid, {}
        hid = self.db.collection("huchas").document().id
        return hid, {hid: {"id_propietario": owner, "nombre": "Efectivo", "tipo_aportacion": "flat", "valor_aportacion": 0,
                           "objetivo": None, "saldo_acumulado": 0, "orden": len(huchas) + 1, "es_metalico": True,
                           "es_principal": False, "activa": True, "created_at": NOW, "updated_at": NOW}}

    @staticmethod
    def _refund_hucha(movement, huchas):
        """Wallet that gets an expense back: its own, or the default one if that is gone."""
        hid = movement.get("hucha_id")
        return hid if hid in huchas and d.is_active(huchas[hid]) else d.expense_hucha(huchas)

    # --- Read tools ---------------------------------------------------------

    def _totals(self, owner, start, end):
        query = self._movement_query(owner, start.isoformat(), end.isoformat() if end else None)
        ingresos = gastos = 0
        for snapshot in query.limit(SUMMARY_LIMIT).stream():
            movement = snapshot.to_dict()
            if not d.counts_in_stats(movement):
                continue
            if movement.get("tipo") == "ingreso":
                ingresos += d.available(movement)
            else:
                gastos += d.available(movement)
        return {"ingresos": d.euros(ingresos), "gastos": d.euros(gastos), "neto": d.euros(ingresos - gastos)}

    def get_overview(self, owner):
        huchas = self._owned("huchas", owner)
        subscriptions = [s for s in self._owned("suscripciones", owner).values() if s.get("activa")]
        month = datetime.now(d.MADRID).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        previous = (month - timedelta(days=1)).replace(day=1)
        pending = self.db.collection("correos_pendientes").where(filter=FieldFilter("id_propietario", "==", owner)) \
            .where(filter=FieldFilter("procesado", "==", False)).limit(100).stream()
        stats = self._stats(owner)
        active = d.ordered(huchas)
        return serialize({
            "date": datetime.now(d.MADRID).date().isoformat(),
            "total_balance": d.euros(sum(cents(h.get("saldo_acumulado") or 0) for _, h in active)),
            "huchas": [public(hid, h) for hid, h in active],
            "current_month": self._totals(owner, month, None),
            "previous_month": self._totals(owner, previous, month),
            "lifetime_totals": {"total_ingresos": stats.get("total_ingresos"), "total_gastos": stats.get("total_gastos")},
            "subscriptions": {"active": len(subscriptions), "monthly_cost": round(float(sum(d.monthly_amount(s) for s in subscriptions)), 2)},
            "pending_emails": sum(1 for _ in pending),
        })

    def list_movements(self, owner, start_date=None, end_date=None, tipo=None, hucha_id=None, categoria=None,
                       text=None, include_internal=True, limit=50, cursor=None):
        query = self._movement_query(owner, start_date, end_date)
        if cursor:
            snapshot = self._ref("movimientos", cursor).get()
            if not snapshot.exists or snapshot.to_dict().get("id_propietario") != owner:
                raise ReviewError("not_found", "Cursor no válido")
            query = query.start_after(snapshot)
        needle = d.name_key(text).strip() if text else None
        items, last, scanned = [], None, 0
        for snapshot in query.limit(SCAN_LIMIT).stream():
            scanned += 1
            last = snapshot.id
            movement = snapshot.to_dict()
            if tipo and movement.get("tipo") != tipo:
                continue
            if hucha_id and movement.get("hucha_id") != hucha_id:
                continue
            if categoria and movement.get("categoria") != categoria:
                continue
            if not include_internal and not d.counts_in_stats(movement):
                continue
            if needle and needle not in d.name_key(f"{movement.get('concepto', '')} {movement.get('original_concept', '')}"):
                continue
            items.append(public(snapshot.id, movement))
            if len(items) == limit:
                break
        # A page may be short because of filters: follow next_cursor until it is null.
        more = len(items) == limit or scanned == SCAN_LIMIT
        return serialize({"items": items, "next_cursor": last if more else None})

    def get_movement(self, owner, movement_id):
        _, movement = self._doc("movimientos", movement_id, owner)
        related = {}
        for other_id in d.linked_ids(movement):
            snapshot = self._ref("movimientos", other_id).get()
            if snapshot.exists and snapshot.to_dict().get("id_propietario") == owner:
                related[other_id] = public(other_id, snapshot.to_dict())
        if movement.get("transfer_id"):
            legs = self.db.collection("movimientos").where(filter=FieldFilter("id_propietario", "==", owner)) \
                .where(filter=FieldFilter("transfer_id", "==", movement["transfer_id"])).stream()
            related.update({s.id: public(s.id, s.to_dict()) for s in legs if s.id != movement_id})
        return serialize({"movement": public(movement_id, movement), "related": list(related.values())})

    def summarize_movements(self, owner, start_date, end_date, group_by="category"):
        huchas = self._owned("huchas", owner)
        labels = {c["id"]: c["label"] for c in self._categories(owner)}
        groups, scanned = {}, 0
        for snapshot in self._movement_query(owner, start_date, end_date).limit(SUMMARY_LIMIT).stream():
            scanned += 1
            movement = snapshot.to_dict()
            if not d.counts_in_stats(movement):
                continue
            if group_by == "month":
                when = movement.get("fecha_operacion")
                key = label = d.local_date(when).strftime("%Y-%m") if d.local_date(when) else "sin_fecha"
            elif group_by == "hucha":
                key = movement.get("hucha_id") or "sin_cartera"
                label = huchas.get(key, {}).get("nombre") or ("Reparto automático" if movement.get("tipo") == "ingreso" else "Sin cartera")
            else:
                key = movement.get("categoria") or "sin_categorizar"
                label = labels.get(key, key)
            group = groups.setdefault(key, {"key": key, "label": label, "ingresos": 0, "gastos": 0, "movements": 0})
            group["ingresos" if movement.get("tipo") == "ingreso" else "gastos"] += d.available(movement)
            group["movements"] += 1
        rows = sorted(groups.values(), key=lambda g: g["key"] if group_by == "month" else -(g["gastos"] + g["ingresos"]))
        for row in rows:
            row["ingresos"], row["gastos"] = d.euros(row["ingresos"]), d.euros(row["gastos"])
        return {"group_by": group_by, "groups": rows,
                "totals": {"ingresos": round(sum(r["ingresos"] for r in rows), 2), "gastos": round(sum(r["gastos"] for r in rows), 2)},
                "truncated": scanned == SUMMARY_LIMIT}

    def list_huchas(self, owner, include_archived=False):
        huchas = self._owned("huchas", owner)
        rows = sorted(huchas.items(), key=lambda item: (item[1].get("orden") or 0, item[0]))
        return serialize({"items": [public(hid, h) for hid, h in rows if include_archived or d.is_active(h)]})

    def list_subscriptions(self, owner):
        today = datetime.now(d.MADRID).date()
        items = []
        for sid, subscription in sorted(self._owned("suscripciones", owner).items(), key=lambda item: item[1].get("nombre") or ""):
            items.append({**public(sid, subscription), "monthly_cost": round(float(d.monthly_amount(subscription)), 2),
                          "next_charge": d.next_charge(subscription, today).isoformat()})
        return serialize({"items": items, "monthly_cost": round(sum(i["monthly_cost"] for i in items if i.get("activa")), 2)})

    def list_categories(self, owner):
        config = self._config(owner)
        return serialize({"categories": self._categories(owner), "category_huchas": config.get("category_huchas", {}),
                          "subscription_categories": d.SUBSCRIPTION_CATEGORIES})

    def list_pending_emails(self, owner):
        query = self.db.collection("correos_pendientes").where(filter=FieldFilter("id_propietario", "==", owner)) \
            .where(filter=FieldFilter("procesado", "==", False)).limit(50)
        return serialize({"items": [public(s.id, s.to_dict()) for s in query.stream()]})

    def list_email_history(self, owner, limit=20, cursor=None):
        query = self.db.collection("correos_historico").where(filter=FieldFilter("id_propietario", "==", owner)) \
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        if cursor:
            snapshot = self._ref("correos_historico", cursor).get()
            if not snapshot.exists or snapshot.to_dict().get("id_propietario") != owner:
                raise ReviewError("not_found", "Cursor no válido")
            query = query.start_after(snapshot)
        snapshots = list(query.limit(limit).stream())
        items = []
        for snapshot in snapshots:
            email = public(snapshot.id, snapshot.to_dict())
            body = email.pop("cuerpo", "") or ""
            items.append({**email, "excerpt": body[:400], "truncated": len(body) > 400})
        return serialize({"items": items, "next_cursor": snapshots[-1].id if len(snapshots) == limit else None})

    def get_email(self, owner, email_id):
        for collection in ("correos_historico", "correos_pendientes"):
            snapshot = self._ref(collection, email_id).get()
            if snapshot.exists and snapshot.to_dict().get("id_propietario") == owner:
                return serialize({"source": collection, "email": public(snapshot.id, snapshot.to_dict())})
        raise ReviewError("not_found", "Correo no disponible")

    # --- Movements ----------------------------------------------------------

    def update_movement(self, owner, movement_id, name=None, category=None, hucha_id=None):
        """A user's own correction: same planner and field protection as an edit in the web."""
        return self.reviews.edit_movement(owner, movement_id, name=name, category=category, hucha_id=hucha_id)

    @write
    def create_movement(self, tx, owner, tipo, concepto, importe, fecha_operacion, hucha_id=None, categoria=None,
                        es_metalico=False, es_interno=False):
        amount = d.amount_cents(importe)
        name = d.clean_text(concepto, 200, "invalid_name", "Concepto no válido")
        moment = d.parse_moment(fecha_operacion)
        huchas = self._owned("huchas", owner, tx)
        stats = self._stats(owner, tx)
        config = self._config(owner, tx)
        if categoria is not None:
            self._require_category(owner, categoria, tipo, tx)
        if not d.ordered(huchas):
            fail("no_hucha", "Crea una cartera antes de registrar movimientos")
        movement = {"id_propietario": owner, "tipo": tipo, "concepto": name, "importe": d.euros(amount), "moneda": "EUR",
                    "fecha_operacion": moment, "es_metalico": bool(es_metalico), "es_interno": bool(es_interno), "created_at": NOW}
        protected, created, deltas, debts = ["concepto"], {}, {}, {}
        target = hucha_id
        if es_metalico:
            target, created = self._cash_hucha(owner, huchas)
        elif target:
            movement["es_metalico"] = bool(self._usable(target, huchas).get("es_metalico"))
            protected.append("hucha_id")
        if categoria is not None:
            movement["categoria"] = categoria
            protected.append("categoria")
        if tipo == "gasto":
            if not target:
                mapped = config.get("category_huchas", {}).get(categoria)
                target = mapped if mapped in huchas and d.is_active(huchas[mapped]) else d.expense_hucha(huchas)
            if not target:
                fail("no_hucha", "Indica de qué cartera sale el gasto")
            deltas[target] = -amount
        elif target:
            deltas[target] = amount
        else:
            split = d.distribute_income(amount, huchas)
            deltas, debts = split["saldos"], split["deudas"]
            movement["reparto_aplicado"] = d.recorded_split(split)
        movement["hucha_id"] = target
        movement["review_protected_fields"] = protected
        ref = self.db.collection("movimientos").document()
        changes = self._apply(tx, huchas, deltas, self._debt_fields(huchas, debts), created)
        if d.counts_in_stats(movement):
            self._bump_stats(tx, owner, stats, **{"ingresos" if tipo == "ingreso" else "gastos": amount})
        tx.set(ref, movement)
        return {"movement": public(ref.id, movement), "hucha_changes": changes}

    @write
    def create_cash_withdrawal(self, tx, owner, hucha_origen_id, importe, concepto, fecha_operacion):
        amount = d.amount_cents(importe)
        name = d.clean_text(concepto, 150, "invalid_name", "Concepto no válido")
        moment = d.parse_moment(fecha_operacion)
        huchas = self._owned("huchas", owner, tx)
        origin = self._usable(hucha_origen_id, huchas)
        cash_id, created = self._cash_hucha(owner, huchas)
        if cash_id == hucha_origen_id:
            fail("invalid_hucha", "La cartera de origen y Efectivo deben ser distintas")
        if cents(origin.get("saldo_acumulado") or 0) < amount:
            fail("insufficient_balance", "Saldo insuficiente en la cartera de origen")
        base = {"id_propietario": owner, "importe": d.euros(amount), "fecha_operacion": moment, "es_interno": True,
                "transfer_id": "transfer-" + uuid4().hex[:16], "created_at": NOW}
        legs = [{**base, "tipo": "gasto", "concepto": f"Retirada de efectivo: {name}", "hucha_id": hucha_origen_id},
                {**base, "tipo": "ingreso", "concepto": f"Entrada en efectivo: {name}", "hucha_id": cash_id, "es_metalico": True}]
        refs = [self.db.collection("movimientos").document() for _ in legs]
        changes = self._apply(tx, huchas, {hucha_origen_id: -amount, cash_id: amount}, created=created)
        for ref, leg in zip(refs, legs):
            tx.set(ref, leg)
        return {"movements": [public(ref.id, leg) for ref, leg in zip(refs, legs)], "hucha_changes": changes}

    @write
    def delete_movement(self, tx, owner, movement_id):
        ref, movement = self._doc("movimientos", movement_id, owner, tx)
        huchas = self._owned("huchas", owner, tx)
        stats = self._stats(owner, tx)
        amount = cents(movement.get("importe") or 0)
        if movement.get("transfer_id"):
            # Both legs of an internal transfer go together, or the wallets stop adding up.
            legs = self.db.collection("movimientos").where(filter=FieldFilter("id_propietario", "==", owner)) \
                .where(filter=FieldFilter("transfer_id", "==", movement["transfer_id"])).stream(transaction=tx)
            legs = {snapshot.id: snapshot.to_dict() for snapshot in legs}
            if len(legs) < 2:
                fail("incomplete_transfer", "No se puede eliminar una transferencia sin su movimiento vinculado")
            deltas = {}
            for leg in legs.values():
                if leg.get("hucha_id") not in huchas:
                    fail("incomplete_transfer", "La transferencia no tiene carteras válidas para poder revertirse")
                value = cents(leg.get("importe") or 0)
                deltas[leg["hucha_id"]] = deltas.get(leg["hucha_id"], 0) + (value if leg.get("tipo") == "gasto" else -value)
            changes = self._apply(tx, huchas, deltas)
            for leg_id in legs:
                tx.delete(self._ref("movimientos", leg_id))
            return {"deleted": [public(leg_id, leg) for leg_id, leg in legs.items()], "hucha_changes": changes}
        related = []
        for other_id in d.linked_ids(movement):
            snapshot = self._ref("movimientos", other_id).get(transaction=tx)
            if snapshot.exists and snapshot.to_dict().get("id_propietario") == owner:
                related.append({**snapshot.to_dict(), "id": other_id})
        unlinked = d.unlink_updates({**movement, "id": movement_id}, related)
        deltas, debts = {}, {}
        if movement.get("tipo") == "gasto":
            target = self._refund_hucha(movement, huchas)
            if target:
                deltas[target] = amount
        elif movement.get("hucha_id"):
            if movement["hucha_id"] in huchas:
                deltas[movement["hucha_id"]] = -amount
        elif d.ordered(huchas):
            reversal = d.income_reversal(movement, huchas)
            deltas, debts = reversal["saldos"], reversal["deudas"]
        changes = self._apply(tx, huchas, deltas, self._debt_fields(huchas, debts, restore=True))
        for other_id, update in unlinked.items():
            if other_id != movement_id:
                tx.update(self._ref("movimientos", other_id),
                          {**{k: DELETE if v is None else v for k, v in update.items()}, "updated_at": NOW})
        if d.counts_in_stats(movement):
            self._bump_stats(tx, owner, stats, **{"ingresos" if movement.get("tipo") == "ingreso" else "gastos": -amount})
        tx.delete(ref)
        return {"deleted": [public(movement_id, movement)], "hucha_changes": changes,
                "unlinked_movements": [k for k in unlinked if k != movement_id]}

    @write
    def convert_movement(self, tx, owner, movement_id, target_hucha_id=None, distribution=None):
        ref, movement = self._doc("movimientos", movement_id, owner, tx)
        if movement.get("es_interno") or movement.get("transfer_id"):
            fail("ineligible_movement", "Las transferencias internas no se pueden convertir")
        if d.linked_ids(movement):
            fail("ineligible_movement", "Deshaz primero las compensaciones de este movimiento")
        huchas = self._owned("huchas", owner, tx)
        stats = self._stats(owner, tx)
        amount = cents(movement.get("importe") or 0)
        deltas = {}
        update = {"categoria": DELETE, "categoria_sugerida": DELETE, "categoria_confianza": DELETE, "updated_at": NOW,
                  "review_protected_fields": sorted(set(movement.get("review_protected_fields", [])) | {"hucha_id", "categoria"})}
        if movement.get("tipo") == "gasto":
            if target_hucha_id:
                fail("invalid_arguments", "target_hucha_id solo se usa al convertir un ingreso en gasto")
            refund = self._refund_hucha(movement, huchas)
            if distribution:
                saldos = {}
                for row in distribution:
                    self._usable(row["hucha_id"], huchas)
                    saldos[row["hucha_id"]] = saldos.get(row["hucha_id"], 0) + d.amount_cents(row["importe"])
                if sum(saldos.values()) != amount:
                    fail("invalid_distribution", "El reparto debe sumar exactamente el importe del movimiento")
                split = {"saldos": saldos, "deudas": {}}
            else:
                # Caps are measured after the expense has been handed back.
                view = {**huchas, **({refund: {**huchas[refund], "saldo_acumulado": d.euros(cents(huchas[refund].get("saldo_acumulado") or 0) + amount)}} if refund else {})}
                split = d.distribute_income(amount, view)
            deltas = dict(split["saldos"])
            if refund:
                deltas[refund] = deltas.get(refund, 0) + amount
            extra = self._debt_fields(huchas, split["deudas"])
            update.update({"tipo": "ingreso", "hucha_id": DELETE, "reparto_aplicado": d.recorded_split(split)})
            stat_change = {"ingresos": amount, "gastos": -amount}
        else:
            if distribution:
                fail("invalid_arguments", "distribution solo se usa al convertir un gasto en ingreso")
            if not target_hucha_id:
                fail("missing_hucha", "Indica la cartera de la que sale el gasto")
            self._usable(target_hucha_id, huchas)
            debts = {}
            if movement.get("hucha_id"):
                if movement["hucha_id"] in huchas:
                    deltas[movement["hucha_id"]] = -amount
            else:
                reversal = d.income_reversal(movement, huchas)
                deltas, debts = dict(reversal["saldos"]), reversal["deudas"]
            deltas[target_hucha_id] = deltas.get(target_hucha_id, 0) - amount
            extra = self._debt_fields(huchas, debts, restore=True)
            update.update({"tipo": "gasto", "hucha_id": target_hucha_id, "reparto_aplicado": DELETE})
            stat_change = {"ingresos": -amount, "gastos": amount}
        changes = self._apply(tx, huchas, deltas, extra)
        self._bump_stats(tx, owner, stats, **stat_change)
        tx.update(ref, update)
        return {"movement_id": movement_id, "tipo": update["tipo"], "hucha_changes": changes}

    @write
    def link_compensation(self, tx, owner, movement_id, allocations):
        _, base = self._doc("movimientos", movement_id, owner, tx)
        pairs = []
        for row in allocations:
            _, other = self._doc("movimientos", row["movement_id"], owner, tx)
            pairs.append(({**other, "id": row["movement_id"]}, d.amount_cents(row["importe"])))
        updates = d.compensation_updates({**base, "id": movement_id}, pairs)
        for key, update in updates.items():
            tx.update(self._ref("movimientos", key), {**update, "updated_at": NOW})
        return {"updated": updates}

    @write
    def unlink_compensation(self, tx, owner, movement_id, other_movement_id=None):
        _, base = self._doc("movimientos", movement_id, owner, tx)
        related = []
        for other_id in ([other_movement_id] if other_movement_id else d.linked_ids(base)):
            snapshot = self._ref("movimientos", other_id).get(transaction=tx)
            if snapshot.exists:
                if snapshot.to_dict().get("id_propietario") != owner:
                    raise ReviewError("not_found", "Documento no disponible")
                related.append({**snapshot.to_dict(), "id": other_id})
        updates = d.unlink_updates({**base, "id": movement_id}, related)
        if not updates:
            fail("not_linked", "Estos movimientos no están compensados entre sí")
        for key, update in updates.items():
            tx.update(self._ref("movimientos", key), {**{k: DELETE if v is None else v for k, v in update.items()}, "updated_at": NOW})
        return {"updated": sorted(updates)}

    # --- Wallets (huchas) ---------------------------------------------------

    @staticmethod
    def _hucha_rules(tipo, valor, objetivo, tope):
        value = 0 if tipo == "resto" else float(valor or 0)
        if isinstance(valor, bool) or value < 0 or (tipo == "porcentaje" and value > 100):
            fail("invalid_hucha", "La aportación no es válida")
        goal = d.euros(d.amount_cents(objetivo)) if objetivo else None
        return {"tipo_aportacion": tipo, "valor_aportacion": value, "objetivo": goal, "tope_objetivo": bool(tope) and goal is not None}

    def _exclusive_roles(self, tx, huchas, hucha_id, data):
        """Only one main wallet and one 'resto' wallet can exist at a time."""
        for other_id, other in huchas.items():
            if other_id == hucha_id:
                continue
            fields = {}
            if data.get("es_principal") and other.get("es_principal"):
                fields["es_principal"] = False
            if data.get("tipo_aportacion") == "resto" and other.get("tipo_aportacion") == "resto":
                fields.update({"tipo_aportacion": "flat", "valor_aportacion": 0})
            if fields:
                tx.update(self._ref("huchas", other_id), {**fields, "updated_at": NOW})

    @write
    def create_hucha(self, tx, owner, nombre, tipo_aportacion, valor_aportacion=0, objetivo=None, es_principal=False, tope_objetivo=False):
        huchas = self._owned("huchas", owner, tx)
        data = {"id_propietario": owner, "nombre": d.clean_text(nombre, 100, "invalid_name", "Nombre no válido"),
                **self._hucha_rules(tipo_aportacion, valor_aportacion, objetivo, tope_objetivo),
                "es_principal": bool(es_principal), "activa": True, "saldo_acumulado": 0, "orden": len(huchas) + 1,
                "created_at": NOW, "updated_at": NOW}
        ref = self.db.collection("huchas").document()
        if d.percentage_total(huchas, {ref.id: data}) > 100:
            fail("invalid_distribution", "Los porcentajes de las carteras superarían el 100 %")
        self._exclusive_roles(tx, huchas, ref.id, data)
        tx.set(ref, data)
        return {"hucha": public(ref.id, data)}

    @write
    def update_hucha(self, tx, owner, hucha_id, nombre=None, tipo_aportacion=None, valor_aportacion=None, objetivo=UNSET,
                     es_principal=None, tope_objetivo=None, subsanar_con=UNSET, subsanar_hasta=None, orden=None):
        huchas = self._owned("huchas", owner, tx)
        current = self._usable(hucha_id, huchas)
        fields = {}
        if nombre is not None:
            fields["nombre"] = d.clean_text(nombre, 100, "invalid_name", "Nombre no válido")
        if orden is not None:
            fields["orden"] = orden
        rules_changed = tipo_aportacion is not None or valor_aportacion is not None or objetivo is not UNSET or tope_objetivo is not None
        if rules_changed:
            if current.get("es_suscripciones"):
                fail("managed_hucha", "La cartera de suscripciones se ajusta sola según tus suscripciones")
            fields.update(self._hucha_rules(
                tipo_aportacion or current.get("tipo_aportacion"),
                current.get("valor_aportacion") if valor_aportacion is None else valor_aportacion,
                current.get("objetivo") if objetivo is UNSET else objetivo,
                current.get("tope_objetivo") if tope_objetivo is None else tope_objetivo))
        if es_principal is not None:
            fields["es_principal"] = es_principal
        if subsanar_con is not UNSET:
            if subsanar_con is not None and (subsanar_con == hucha_id or not d.is_active(huchas.get(subsanar_con, {"activa": False}))):
                fail("invalid_hucha", "La cartera prestamista no es válida")
            fields["subsanar_con"] = subsanar_con
        if subsanar_hasta is not None:
            fields["subsanar_hasta"] = d.euros(d.amount_cents(subsanar_hasta, allow_zero=True))
        if not fields:
            fail("invalid_edit", "No hay campos para editar")
        merged = {**current, **fields}
        if d.percentage_total(huchas, {hucha_id: merged}) > 100:
            fail("invalid_distribution", "Los porcentajes de las carteras superarían el 100 %")
        self._exclusive_roles(tx, huchas, hucha_id, fields)
        tx.update(self._ref("huchas", hucha_id), {**fields, "updated_at": NOW})
        return {"hucha": public(hucha_id, merged)}

    @write
    def archive_hucha(self, tx, owner, hucha_id, distribution=None):
        huchas = self._owned("huchas", owner, tx)
        hucha = self._usable(hucha_id, huchas)
        others = {hid: h for hid, h in huchas.items() if hid != hucha_id and d.is_active(h)}
        if hucha.get("es_suscripciones"):
            fail("managed_hucha", "Esta cartera es gestionada automáticamente por tus suscripciones")
        if not others:
            fail("last_hucha", "No puedes eliminar tu única cartera. Crea otra primero")
        if cents(hucha.get("deuda_pendiente") or 0) or any(h.get("deuda_con") == hucha_id and cents(h.get("deuda_pendiente") or 0) for h in others.values()):
            fail("unsupported_debt", "Resuelve antes la deuda entre carteras (revert_hucha_debt)")
        balance = cents(hucha.get("saldo_acumulado") or 0)
        if balance < 0:
            fail("negative_balance", "La cartera tiene saldo negativo; compénsalo con una transferencia antes de archivarla")
        deltas = {}
        if balance and distribution:
            for row in distribution:
                if row["hucha_id"] not in others:
                    fail("invalid_hucha", "El reparto solo admite otras carteras activas")
                deltas[row["hucha_id"]] = deltas.get(row["hucha_id"], 0) + d.amount_cents(row["importe"])
            if sum(deltas.values()) != balance:
                fail("invalid_distribution", "El reparto debe sumar exactamente el saldo de la cartera")
        elif balance:
            deltas = d.distribute_income(balance, others, plain=True)["saldos"]
        changes = self._apply(tx, huchas, {**deltas, hucha_id: -balance}, {hucha_id: {"activa": False}})
        changes.setdefault(hucha_id, {"nombre": hucha.get("nombre"), "saldo_antes": 0, "saldo_despues": 0})
        return {"archived": hucha_id, "hucha_changes": changes}

    @write
    def restore_hucha(self, tx, owner, hucha_id):
        ref, hucha = self._doc("huchas", hucha_id, owner, tx)
        tx.update(ref, {"activa": True, "updated_at": NOW})
        return {"hucha": public(hucha_id, {**hucha, "activa": True})}

    @write
    def transfer_between_huchas(self, tx, owner, from_hucha_id, to_hucha_id, importe):
        if from_hucha_id == to_hucha_id:
            fail("invalid_hucha", "Debes seleccionar carteras distintas")
        huchas = self._owned("huchas", owner, tx)
        source, target = self._usable(from_hucha_id, huchas), self._usable(to_hucha_id, huchas)
        amount = d.amount_cents(importe)
        if cents(source.get("saldo_acumulado") or 0) < amount:
            fail("insufficient_balance", "Saldo insuficiente en la cartera de origen")
        free = d.room(target)
        accepted = amount if free is None else min(amount, free)
        deltas = {from_hucha_id: -amount, to_hucha_id: accepted}
        overflow = amount - accepted
        if overflow:
            # A capped destination passes the surplus on; it must never vanish or bounce back.
            rest = d.fallback_hucha(huchas, exclude=(to_hucha_id,))
            rest_room = d.room(huchas[rest]) if rest else 0
            if not rest or rest == from_hucha_id or (rest_room is not None and rest_room < overflow):
                fail("no_capacity", "La cartera destino está llena y no hay dónde dejar el sobrante")
            deltas[rest] = overflow
        return {"hucha_changes": self._apply(tx, huchas, deltas)}

    def _internal_legs(self, owner, amount, expense, income):
        """Two legs of an internal transfer; `expense`/`income` are (hucha_id, concept)."""
        base = {"id_propietario": owner, "importe": d.euros(amount), "es_interno": True,
                "transfer_id": "transfer-" + uuid4().hex[:16], "fecha_operacion": NOW, "created_at": NOW}
        return [(self.db.collection("movimientos").document(), {**base, "tipo": tipo, "hucha_id": hid, "concepto": concept})
                for tipo, (hid, concept) in (("gasto", expense), ("ingreso", income))]

    @write
    def cover_hucha_shortfall(self, tx, owner, hucha_id):
        huchas = self._owned("huchas", owner, tx)
        hucha = self._usable(hucha_id, huchas)
        amount = cents(hucha.get("subsanar_hasta") or 0) - cents(hucha.get("saldo_acumulado") or 0)
        if amount <= 0:
            fail("not_needed", "Esta cartera no necesita ser subsanada")
        lender_id = hucha.get("subsanar_con")
        if not lender_id or lender_id == hucha_id or lender_id not in huchas or not d.is_active(huchas[lender_id]):
            lender_id = d.fallback_hucha(huchas, exclude=(hucha_id,))
        if not lender_id:
            fail("invalid_hucha", "No se encontró una cartera prestamista")
        debt = cents(hucha.get("deuda_pendiente") or 0)
        if debt and hucha.get("deuda_con") not in (None, lender_id):
            fail("unsupported_debt", "La cartera ya debe dinero a otra cartera; revierte esa deuda antes")
        lender = huchas[lender_id]
        legs = self._internal_legs(owner, amount, (lender_id, f"Préstamo a {hucha.get('nombre')}"),
                                   (hucha_id, f"Subsanación desde {lender.get('nombre')}"))
        changes = self._apply(tx, huchas, {lender_id: -amount, hucha_id: amount},
                              {hucha_id: {"deuda_pendiente": d.euros(debt + amount), "deuda_con": lender_id}})
        for ref, leg in legs:
            tx.set(ref, leg)
        return {"amount": d.euros(amount), "lender_hucha_id": lender_id, "hucha_changes": changes}

    @write
    def revert_hucha_debt(self, tx, owner, hucha_id):
        huchas = self._owned("huchas", owner, tx)
        hucha = self._usable(hucha_id, huchas)
        debt, lender_id = cents(hucha.get("deuda_pendiente") or 0), hucha.get("deuda_con")
        if not debt or not lender_id:
            fail("not_needed", "Esta cartera no tiene ninguna deuda")
        if lender_id not in huchas:
            fail("invalid_hucha", "No se puede revertir: la cartera prestamista ya no existe")
        lender = huchas[lender_id]
        legs = self._internal_legs(owner, debt, (hucha_id, f"Reversión de subsanación (devuelto a {lender.get('nombre')})"),
                                   (lender_id, f"Reversión de préstamo (recuperado de {hucha.get('nombre')})"))
        changes = self._apply(tx, huchas, {hucha_id: -debt, lender_id: debt},
                              {hucha_id: {"deuda_pendiente": DELETE, "deuda_con": DELETE}})
        for ref, leg in legs:
            tx.set(ref, leg)
        return {"amount": d.euros(debt), "hucha_changes": changes}

    # --- Subscriptions ------------------------------------------------------

    def _system_hucha(self, huchas, create):
        existing = next((hid for hid, h in sorted(huchas.items()) if h.get("es_suscripciones")), None)
        if existing or not create:
            return existing, False
        return self.db.collection("huchas").document().id, True

    def _sync_system_hucha(self, tx, owner, huchas, subscriptions, system_id, is_new):
        """Keep the automatic 'Suscripciones' wallet's monthly target equal to what it must cover."""
        if not system_id:
            return None
        target = d.subscriptions_target(subscriptions.values(), system_id)
        fields = {"objetivo": target or None, "valor_aportacion": target, "tipo_aportacion": "flat",
                  "tope_objetivo": False, "updated_at": NOW}
        if is_new:
            tx.set(self._ref("huchas", system_id), {
                "id_propietario": owner, "nombre": "Suscripciones", "saldo_acumulado": 0, "orden": len(huchas) + 1,
                "es_principal": False, "es_suscripciones": True, "activa": True, "created_at": NOW, **fields})
        else:
            tx.update(self._ref("huchas", system_id), fields)
        return {"hucha_id": system_id, "monthly_target": target}

    @staticmethod
    def _subscription_fields(data, huchas):
        amount = d.amount_cents(data.get("importe"))
        share = data.get("mi_parte")
        if share is not None and not 0 < d.amount_cents(share) <= amount:
            fail("invalid_subscription", "La parte propia debe estar entre 0 y el importe total")
        if data.get("frecuencia") not in d.FREQUENCY_MONTHS or data.get("categoria") not in d.SUBSCRIPTION_CATEGORIES:
            fail("invalid_subscription", "Frecuencia o categoría de suscripción no válida")
        if d.local_date(data.get("fecha_inicio")) is None:
            fail("invalid_date", "fecha_inicio debe ser AAAA-MM-DD")
        day = data.get("dia_pago")
        if isinstance(day, bool) or not isinstance(day, int) or not 1 <= day <= 31:
            fail("invalid_subscription", "El día de pago debe estar entre 1 y 31")
        if data.get("hucha_id") and (data["hucha_id"] not in huchas or not d.is_active(huchas[data["hucha_id"]])):
            fail("invalid_hucha", "La cartera no existe o está archivada")
        return {"nombre": d.clean_text(data.get("nombre"), 100, "invalid_name", "Nombre no válido"),
                "importe": d.euros(amount), "frecuencia": data["frecuencia"],
                "fecha_inicio": d.local_date(data["fecha_inicio"]).isoformat(), "dia_pago": day,
                "categoria": data["categoria"], "color": data.get("color") or d.SUBSCRIPTION_COLORS[0],
                "activa": bool(data.get("activa", True)), "hucha_id": data.get("hucha_id") or None,
                "mi_parte": None if share is None else d.euros(d.amount_cents(share))}

    @write
    def create_subscription(self, tx, owner, nombre, importe, dia_pago, frecuencia="mensual", categoria="otros", color=None,
                            fecha_inicio=None, hucha_id=None, mi_parte=None, activa=True):
        huchas = self._owned("huchas", owner, tx)
        subscriptions = self._owned("suscripciones", owner, tx)
        system_id, is_new = self._system_hucha(huchas, create=True)
        data = self._subscription_fields({
            "nombre": nombre, "importe": importe, "dia_pago": dia_pago, "frecuencia": frecuencia, "categoria": categoria,
            "color": color or d.SUBSCRIPTION_COLORS[len(subscriptions) % len(d.SUBSCRIPTION_COLORS)],
            "fecha_inicio": fecha_inicio or datetime.now(d.MADRID).date().isoformat(), "hucha_id": hucha_id,
            "mi_parte": mi_parte, "activa": activa}, huchas)
        data["hucha_id"] = data["hucha_id"] or system_id
        ref = self.db.collection("suscripciones").document()
        synced = self._sync_system_hucha(tx, owner, huchas, {**subscriptions, ref.id: data}, system_id, is_new)
        tx.set(ref, {**data, "id_propietario": owner, "created_at": NOW, "updated_at": NOW})
        return {"subscription": public(ref.id, data), "subscriptions_hucha": synced}

    @write
    def update_subscription(self, tx, owner, subscription_id, **changes):
        ref, current = self._doc("suscripciones", subscription_id, owner, tx)
        if not changes:
            fail("invalid_edit", "No hay campos para editar")
        huchas = self._owned("huchas", owner, tx)
        subscriptions = self._owned("suscripciones", owner, tx)
        defaults = {"frecuencia": "mensual", "categoria": "otros", "fecha_inicio": datetime.now(d.MADRID).date().isoformat()}
        data = self._subscription_fields({**defaults, **{k: v for k, v in current.items() if v is not None}, **changes}, huchas)
        system_id, is_new = self._system_hucha(huchas, create=data["activa"])
        data["hucha_id"] = data["hucha_id"] or system_id
        synced = self._sync_system_hucha(tx, owner, huchas, {**subscriptions, subscription_id: data}, system_id, is_new)
        tx.update(ref, {**data, "updated_at": NOW})
        return {"subscription": public(subscription_id, {**current, **data}), "subscriptions_hucha": synced}

    @write
    def delete_subscription(self, tx, owner, subscription_id):
        ref, current = self._doc("suscripciones", subscription_id, owner, tx)
        huchas = self._owned("huchas", owner, tx)
        remaining = {sid: s for sid, s in self._owned("suscripciones", owner, tx).items() if sid != subscription_id}
        system_id, is_new = self._system_hucha(huchas, create=any(s.get("activa") for s in remaining.values()))
        synced = self._sync_system_hucha(tx, owner, huchas, remaining, system_id, is_new)
        tx.delete(ref)
        return {"deleted": public(subscription_id, current), "subscriptions_hucha": synced}

    @write
    def cancel_subscription(self, tx, owner, subscription_id, undo=False):
        ref, current = self._doc("suscripciones", subscription_id, owner, tx)
        if undo:
            fields = {"cancelando": False, "cancel_at": None}
        else:
            # It stays active until the next charge, when the synchroniser removes it.
            fields = {"cancelando": True, "cancel_at": d.next_charge(current, datetime.now(d.MADRID).date(), include_today=False).isoformat()}
        tx.update(ref, {**fields, "updated_at": NOW})
        return {"subscription": public(subscription_id, {**current, **fields})}

    # --- Emails awaiting manual review --------------------------------------

    @write
    def approve_pending_email(self, tx, owner, email_id, tipo, concepto, importe, fecha_operacion, hucha_id=None):
        email_ref, email = self._doc("correos_pendientes", email_id, owner, tx)
        if email.get("procesado") is True:
            raise ReviewError("not_found", "Este correo ya fue procesado o descartado")
        amount = d.amount_cents(importe)
        name = d.clean_text(concepto, 200, "invalid_name", "Concepto no válido")
        moment = d.parse_moment(fecha_operacion)
        huchas = self._owned("huchas", owner, tx)
        stats = self._stats(owner, tx)
        if not d.ordered(huchas):
            fail("no_hucha", "Crea una cartera antes de registrar movimientos")
        movement = {"id_propietario": owner, "tipo": tipo, "concepto": name, "importe": d.euros(amount),
                    "fecha_operacion": moment, "id_correo_origen": email.get("email_id"),
                    "review_protected_fields": ["concepto", "hucha_id"] if hucha_id else ["concepto"], "created_at": NOW}
        deltas, debts, target = {}, {}, hucha_id
        if target:
            self._usable(target, huchas)
            deltas[target] = amount if tipo == "ingreso" else -amount
        elif tipo == "gasto":
            target = d.expense_hucha(huchas)
            if not target:
                fail("no_hucha", "Indica de qué cartera sale el gasto")
            deltas[target] = -amount
        else:
            split = d.distribute_income(amount, huchas)
            deltas, debts = split["saldos"], split["deudas"]
            movement["reparto_aplicado"] = d.recorded_split(split)
        movement["hucha_id"] = target
        ref = self.db.collection("movimientos").document()
        changes = self._apply(tx, huchas, deltas, self._debt_fields(huchas, debts))
        self._bump_stats(tx, owner, stats, **{"ingresos" if tipo == "ingreso" else "gastos": amount})
        tx.set(ref, movement)
        # Same durable handoff as the web: the synchroniser queues the automatic review from it.
        tx.set(self._ref("review_handoffs", ref.id), {"id_propietario": owner, "movement_id": ref.id,
                                                      "email_id": email.get("email_id"), "created_at": NOW})
        tx.delete(email_ref)
        return {"movement": public(ref.id, movement), "hucha_changes": changes}

    @write
    def discard_pending_email(self, tx, owner, email_id):
        ref, _ = self._doc("correos_pendientes", email_id, owner, tx)
        tx.delete(ref)
        return {"discarded": email_id}

    # --- Categories ---------------------------------------------------------

    @write
    def create_category(self, tx, owner, label, tipo):
        name = " ".join(d.clean_text(label, 200, "invalid_name", "Nombre no válido").split())
        if len(name) > 50:
            fail("invalid_name", "Escribe un nombre de entre 1 y 50 caracteres")
        if any(d.name_key(c.get("label") or "") == d.name_key(name) and (c.get("tipo") == tipo or "ambos" in (c.get("tipo"), tipo))
               for c in self._categories(owner, tx)):
            fail("duplicate_category", "Ya tienes una categoría con ese nombre para este tipo de movimiento")
        ref = self.db.collection("categorias").document(owner).collection("items").document(d.custom_category_id(name, tipo))
        if ref.get(transaction=tx).exists:
            fail("duplicate_category", "Ya tienes una categoría con ese nombre")
        tx.set(ref, {"label": name, "tipo": tipo, "created_at": NOW})
        return {"category": {"id": ref.id, "label": name, "tipo": tipo}}

    @write
    def set_category_hucha(self, tx, owner, category, hucha_id=None):
        ref = self.db.collection("review_configuration").document(owner)
        config = self._config(owner, tx)
        mapping = dict(config.get("category_huchas") or {})
        if hucha_id:
            self._require_category(owner, category, "gasto", tx)
            _, hucha = self._doc("huchas", hucha_id, owner, tx)
            if not d.is_active(hucha) or hucha.get("es_metalico") or hucha.get("es_interno"):
                fail("invalid_hucha", "Elige una cartera activa para gastos bancarios")
            mapping[category] = hucha_id
            if len(mapping) > 200:
                fail("invalid_category", "Demasiadas categorías asignadas")
        else:
            mapping.pop(checked_id(category), None)
        revision = config.get("revision", 0) + 1
        tx.set(ref, {"category_huchas": mapping, "revision": revision, "updated_at": NOW, "last_changed_category": category})
        return {"category_huchas": mapping, "revision": revision}
