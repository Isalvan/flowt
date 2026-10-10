"""The finance tools end to end against an atomic in-memory Firestore."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from finance.service import FinanceService
from reviews.domain import ReviewError
from .memory_firestore import MemoryFirestore

NOW = datetime.now(timezone.utc)


@pytest.fixture
def world():
    db = MemoryFirestore()
    db.put("huchas", "main", {"id_propietario": "owner", "nombre": "Cuenta", "tipo_aportacion": "resto", "es_principal": True,
                              "saldo_acumulado": 1000, "orden": 1, "activa": True})
    db.put("huchas", "trip", {"id_propietario": "owner", "nombre": "Viaje", "tipo_aportacion": "porcentaje", "valor_aportacion": 10,
                              "saldo_acumulado": 200, "objetivo": 250, "tope_objetivo": True, "orden": 2, "activa": True})
    db.put("huchas", "fixed", {"id_propietario": "owner", "nombre": "Fijos", "tipo_aportacion": "flat", "valor_aportacion": 100,
                               "saldo_acumulado": 0, "orden": 3, "activa": True})
    db.put("huchas", "theirs", {"id_propietario": "other", "nombre": "Ajena", "tipo_aportacion": "resto", "saldo_acumulado": 500, "orden": 1})
    db.put("movimientos", "theirs", {"id_propietario": "other", "tipo": "gasto", "concepto": "Ajeno", "importe": 5,
                                     "hucha_id": "theirs", "fecha_operacion": NOW})
    db.put("stats", "owner", {"total_ingresos": 5000, "total_gastos": 3000})
    service = FinanceService(db)
    service._atomic = service.reviews._atomic = db.atomic
    return db, service


def balances(db, owner="owner"):
    return {key: data["saldo_acumulado"] for key, data in db.docs("huchas").items() if data["id_propietario"] == owner}


def refused(world, code, call):
    """The call fails with `code` and leaves every document untouched."""
    db, _ = world
    before, writes = deepcopy(db.data), db.committed_writes
    with pytest.raises(ReviewError) as error:
        call()
    assert error.value.code == code
    assert db.data == before and db.committed_writes == writes


def expense(service, **overrides):
    arguments = {"tipo": "gasto", "concepto": "Mercadona", "importe": 84.5, "fecha_operacion": NOW.isoformat(), **overrides}
    return service.create_movement("owner", **arguments)


# --- Movements --------------------------------------------------------------

def test_expense_charges_the_chosen_wallet_and_protects_the_user_choices(world):
    db, service = world
    result = expense(service, hucha_id="trip", categoria="alimentacion")
    stored = db.doc("movimientos", result["movement"]["id"])
    assert balances(db) == {"main": 1000, "trip": 115.5, "fixed": 0}
    assert stored["id_propietario"] == "owner" and stored["hucha_id"] == "trip" and stored["importe"] == 84.5
    assert stored["review_protected_fields"] == ["concepto", "hucha_id", "categoria"]
    assert result["hucha_changes"]["trip"] == {"nombre": "Viaje", "saldo_antes": 200.0, "saldo_despues": 115.5}
    assert db.doc("stats", "owner")["total_gastos"] == 3084.5
    assert "id_propietario" not in result["movement"]


def test_expense_without_wallet_uses_its_category_wallet_then_the_main_one(world):
    db, service = world
    db.put("review_configuration", "owner", {"revision": 1, "category_huchas": {"ocio": "trip"}})
    assert expense(service, categoria="ocio")["movement"]["hucha_id"] == "trip"
    assert expense(service, categoria="alimentacion")["movement"]["hucha_id"] == "main"
    assert expense(service)["movement"]["hucha_id"] == "main"


def test_income_is_split_by_wallet_rules_and_deleting_it_restores_everything(world):
    db, service = world
    db.data[("huchas", "fixed")].update({"deuda_pendiente": 30, "deuda_con": "main"})
    before = deepcopy(db.docs("huchas"))
    created = service.create_movement("owner", tipo="ingreso", concepto="Nómina", importe=1000, fecha_operacion="2026-10-01")
    assert balances(db) == {"main": 1880, "trip": 250, "fixed": 70}
    assert db.doc("huchas", "fixed")["deuda_pendiente"] == 0 and "deuda_con" not in db.doc("huchas", "fixed")
    assert db.doc("stats", "owner")["total_ingresos"] == 6000
    # The wallet rules change before the income is removed: the recorded split still undoes it exactly.
    db.data[("huchas", "fixed")]["valor_aportacion"] = 500
    service.delete_movement("owner", movement_id=created["movement"]["id"])
    assert balances(db) == {"main": 1000, "trip": 200, "fixed": 0}
    assert db.doc("huchas", "fixed")["deuda_pendiente"] == 30 and db.doc("huchas", "fixed")["deuda_con"] == "main"
    assert db.doc("stats", "owner")["total_ingresos"] == 5000
    assert db.doc("movimientos", created["movement"]["id"]) is None
    assert {k: v["saldo_acumulado"] for k, v in before.items()} == {**balances(db), "theirs": 500}


def test_retry_with_the_same_operation_id_applies_once(world):
    db, service = world
    first = expense(service, operation_id="retry-1")
    writes = db.committed_writes
    assert expense(service, operation_id="retry-1") == first
    assert db.committed_writes == writes and balances(db)["main"] == 915.5
    assert len([m for m in db.docs("movimientos").values() if m["id_propietario"] == "owner"]) == 1
    refused(world, "operation_conflict", lambda: expense(service, operation_id="retry-1", importe=1))
    # Another user may reuse the same key without seeing this result.
    db.put("huchas", "theirs", {**db.doc("huchas", "theirs"), "es_principal": True, "activa": True})
    assert service.create_movement("other", operation_id="retry-1", tipo="gasto", concepto="Otro", importe=1,
                                   fecha_operacion="2026-10-01")["movement"]["id"] != first["movement"]["id"]


@pytest.mark.parametrize("code,arguments", [
    ("invalid_category", {"categoria": "nomina"}),           # income category on an expense
    ("invalid_hucha", {"hucha_id": "theirs"}),              # someone else's wallet
    ("invalid_hucha", {"hucha_id": "missing"}),
    ("invalid_amount", {"importe": 0}),
    ("invalid_date", {"fecha_operacion": "mañana"}),
    ("invalid_name", {"concepto": " \x00 "}),
])
def test_invalid_movements_write_nothing(world, code, arguments):
    refused(world, code, lambda: expense(world[1], **arguments))


def test_one_user_cannot_touch_another_users_data(world):
    _, service = world
    for call in (lambda: service.get_movement("owner", movement_id="theirs"),
                 lambda: service.delete_movement("owner", movement_id="theirs"),
                 lambda: service.convert_movement("owner", movement_id="theirs", target_hucha_id="main"),
                 lambda: service.restore_hucha("owner", hucha_id="theirs")):
        refused(world, "not_found", call)
    refused(world, "invalid_hucha", lambda: service.transfer_between_huchas("owner", from_hucha_id="main", to_hucha_id="theirs", importe=1))
    assert all(m["id"] != "theirs" for m in service.list_movements("owner")["items"])
    assert [h["id"] for h in service.list_huchas("owner")["items"]] == ["main", "trip", "fixed"]


def test_cash_withdrawal_is_an_internal_transfer_removed_as_a_whole(world):
    db, service = world
    result = service.create_cash_withdrawal("owner", hucha_origen_id="main", importe=60, concepto="Cajero", fecha_operacion="2026-10-02")
    out_leg, in_leg = result["movements"]
    cash_id = in_leg["hucha_id"]
    assert db.doc("huchas", cash_id)["es_metalico"] is True and db.doc("huchas", cash_id)["saldo_acumulado"] == 60
    assert balances(db)["main"] == 940 and out_leg["transfer_id"] == in_leg["transfer_id"]
    assert db.doc("stats", "owner") == {"total_ingresos": 5000, "total_gastos": 3000}
    refused(world, "insufficient_balance", lambda: service.create_cash_withdrawal(
        "owner", hucha_origen_id="fixed", importe=60, concepto="Cajero", fecha_operacion="2026-10-02"))
    deleted = service.delete_movement("owner", movement_id=in_leg["id"])
    assert len(deleted["deleted"]) == 2
    assert balances(db)["main"] == 1000 and db.doc("huchas", cash_id)["saldo_acumulado"] == 0
    assert db.doc("movimientos", out_leg["id"]) is None


def test_cash_expense_uses_the_cash_wallet(world):
    db, service = world
    movement = expense(service, es_metalico=True, importe=10)["movement"]
    assert db.doc("huchas", movement["hucha_id"])["nombre"] == "Efectivo"
    assert db.doc("huchas", movement["hucha_id"])["saldo_acumulado"] == -10
    assert expense(service, es_metalico=True, importe=5)["movement"]["hucha_id"] == movement["hucha_id"]


def test_converting_back_and_forth_conserves_money(world):
    db, service = world
    movement_id = expense(service, hucha_id="trip", importe=40, categoria="ocio")["movement"]["id"]
    total = sum(balances(db).values())
    service.convert_movement("owner", movement_id=movement_id, distribution=[{"hucha_id": "main", "importe": 25}, {"hucha_id": "fixed", "importe": 15}])
    stored = db.doc("movimientos", movement_id)
    assert stored["tipo"] == "ingreso" and "hucha_id" not in stored and "categoria" not in stored
    assert balances(db) == {"main": 1025, "trip": 200, "fixed": 15}
    assert sum(balances(db).values()) == total + 80  # the 40 € expense is gone and a 40 € income arrived
    assert db.doc("stats", "owner") == {**db.doc("stats", "owner"), "total_ingresos": 5040, "total_gastos": 3000}
    service.convert_movement("owner", movement_id=movement_id, target_hucha_id="trip")
    assert balances(db) == {"main": 1000, "trip": 160, "fixed": 0}
    assert db.doc("movimientos", movement_id)["hucha_id"] == "trip" and "reparto_aplicado" not in db.doc("movimientos", movement_id)
    refused(world, "invalid_distribution", lambda: service.convert_movement(
        "owner", movement_id=movement_id, distribution=[{"hucha_id": "main", "importe": 1}]))
    income = service.create_movement("owner", tipo="ingreso", concepto="Venta", importe=5, fecha_operacion="2026-10-01")["movement"]["id"]
    refused(world, "missing_hucha", lambda: service.convert_movement("owner", movement_id=income))


def test_refund_links_and_deleting_one_side_unlinks_the_other(world):
    db, service = world
    gasto = expense(service, importe=45)["movement"]["id"]
    ingreso = service.create_movement("owner", tipo="ingreso", concepto="Bizum cena", importe=22.5, fecha_operacion="2026-10-03", hucha_id="main")["movement"]["id"]
    service.link_compensation("owner", movement_id=gasto, allocations=[{"movement_id": ingreso, "importe": 22.5}])
    assert db.doc("movimientos", gasto)["importe_neto"] == 22.5
    assert db.doc("movimientos", ingreso)["compensaciones_destinos"] == [{"gasto_id": gasto, "importe": 22.5}]
    refused(world, "invalid_compensation", lambda: service.link_compensation(
        "owner", movement_id=gasto, allocations=[{"movement_id": ingreso, "importe": 1}]))
    refused(world, "ineligible_movement", lambda: service.convert_movement("owner", movement_id=gasto))
    assert service.get_movement("owner", movement_id=gasto)["related"][0]["id"] == ingreso
    service.delete_movement("owner", movement_id=ingreso)
    assert "compensado_por_detalles" not in db.doc("movimientos", gasto) and "importe_neto" not in db.doc("movimientos", gasto)
    refused(world, "not_linked", lambda: service.unlink_compensation("owner", movement_id=gasto))


def test_update_movement_is_a_manual_decision_with_the_review_planner(world):
    db, service = world
    movement_id = expense(service, importe=20)["movement"]["id"]
    db.put("review_configuration", "owner", {"revision": 1, "category_huchas": {"ocio": "trip"}})
    db.data[("movimientos", movement_id)]["review_protected_fields"] = ["concepto"]
    service.update_movement("owner", movement_id=movement_id, name="Cine", category="ocio")
    stored = db.doc("movimientos", movement_id)
    assert stored["concepto"] == "Cine" and stored["categoria"] == "ocio" and stored["hucha_id"] == "trip"
    assert set(stored["review_protected_fields"]) == {"concepto", "categoria"}
    assert balances(db) == {"main": 1000, "trip": 180, "fixed": 0}


# --- Wallets ----------------------------------------------------------------

def test_wallet_roles_stay_unique_and_percentages_within_one_hundred(world):
    db, service = world
    created = service.create_hucha("owner", nombre="Ahorro", tipo_aportacion="resto", es_principal=True, objetivo=5000, tope_objetivo=True)["hucha"]
    assert created["saldo_acumulado"] == 0 and created["orden"] == 4 and created["tope_objetivo"] is True
    assert db.doc("huchas", "main")["es_principal"] is False
    assert db.doc("huchas", "main")["tipo_aportacion"] == "flat" and db.doc("huchas", "main")["valor_aportacion"] == 0
    assert db.doc("huchas", "theirs")["tipo_aportacion"] == "resto"
    refused(world, "invalid_distribution", lambda: service.create_hucha("owner", nombre="Demasiado", tipo_aportacion="porcentaje", valor_aportacion=95))
    refused(world, "invalid_distribution", lambda: service.update_hucha("owner", hucha_id="fixed", tipo_aportacion="porcentaje", valor_aportacion=91))
    updated = service.update_hucha("owner", hucha_id="trip", objetivo=None, nombre="Japón")["hucha"]
    assert updated["objetivo"] is None and updated["tope_objetivo"] is False and updated["valor_aportacion"] == 10
    refused(world, "invalid_edit", lambda: service.update_hucha("owner", hucha_id="trip"))


def test_transfer_respects_balance_and_capped_goals(world):
    db, service = world
    service.transfer_between_huchas("owner", from_hucha_id="main", to_hucha_id="fixed", importe=100)
    assert balances(db) == {"main": 900, "trip": 200, "fixed": 100}
    refused(world, "insufficient_balance", lambda: service.transfer_between_huchas("owner", from_hucha_id="fixed", to_hucha_id="main", importe=101))
    # Only 50 € fit in the capped trip wallet; the other 30 € go to the rest wallet instead of vanishing.
    changes = service.transfer_between_huchas("owner", from_hucha_id="fixed", to_hucha_id="trip", importe=80)["hucha_changes"]
    assert balances(db) == {"main": 930, "trip": 250, "fixed": 20} and set(changes) == {"main", "trip", "fixed"}
    refused(world, "no_capacity", lambda: service.transfer_between_huchas("owner", from_hucha_id="main", to_hucha_id="trip", importe=10))


def test_archive_moves_the_balance_and_refuses_unsafe_cases(world):
    db, service = world
    refused(world, "invalid_distribution", lambda: service.archive_hucha("owner", hucha_id="trip", distribution=[{"hucha_id": "main", "importe": 1}]))
    refused(world, "invalid_hucha", lambda: service.archive_hucha("owner", hucha_id="trip", distribution=[{"hucha_id": "theirs", "importe": 200}]))
    service.archive_hucha("owner", hucha_id="trip")
    assert balances(db) == {"main": 1100, "trip": 0, "fixed": 100} and db.doc("huchas", "trip")["activa"] is False
    assert [h["id"] for h in service.list_huchas("owner")["items"]] == ["main", "fixed"]
    assert len(service.list_huchas("owner", include_archived=True)["items"]) == 3
    service.restore_hucha("owner", hucha_id="trip")
    assert db.doc("huchas", "trip")["activa"] is True
    db.data[("huchas", "fixed")].update({"deuda_pendiente": 10, "deuda_con": "main"})
    refused(world, "unsupported_debt", lambda: service.archive_hucha("owner", hucha_id="fixed"))
    refused(world, "unsupported_debt", lambda: service.archive_hucha("owner", hucha_id="main"))
    db.put("huchas", "solo", {"id_propietario": "solo", "nombre": "Única", "saldo_acumulado": 0})
    refused(world, "last_hucha", lambda: service.archive_hucha("solo", hucha_id="solo"))


def test_loan_between_wallets_and_its_reversal(world):
    db, service = world
    service.update_hucha("owner", hucha_id="fixed", subsanar_hasta=150, subsanar_con="trip")
    result = service.cover_hucha_shortfall("owner", hucha_id="fixed")
    assert result["amount"] == 150 and result["lender_hucha_id"] == "trip"
    assert balances(db) == {"main": 1000, "trip": 50, "fixed": 150}
    assert db.doc("huchas", "fixed")["deuda_pendiente"] == 150 and db.doc("huchas", "fixed")["deuda_con"] == "trip"
    legs = [m for m in db.docs("movimientos").values() if m.get("transfer_id")]
    assert len(legs) == 2 and all(m["es_interno"] for m in legs)
    refused(world, "not_needed", lambda: service.cover_hucha_shortfall("owner", hucha_id="fixed"))
    service.revert_hucha_debt("owner", hucha_id="fixed")
    assert balances(db) == {"main": 1000, "trip": 200, "fixed": 0}
    assert "deuda_pendiente" not in db.doc("huchas", "fixed") and "deuda_con" not in db.doc("huchas", "fixed")
    refused(world, "not_needed", lambda: service.revert_hucha_debt("owner", hucha_id="fixed"))


# --- Subscriptions ----------------------------------------------------------

def test_subscriptions_keep_the_automatic_wallet_target_in_step(world):
    db, service = world
    netflix = service.create_subscription("owner", nombre="Netflix", importe=17.99, dia_pago=12, categoria="streaming")
    system_id = netflix["subscriptions_hucha"]["hucha_id"]
    system = db.doc("huchas", system_id)
    assert system["es_suscripciones"] is True and system["objetivo"] == 17.99 and system["valor_aportacion"] == 17.99
    assert netflix["subscription"]["hucha_id"] == system_id and netflix["subscription"]["frecuencia"] == "mensual"
    spotify = service.create_subscription("owner", nombre="Spotify", importe=14.99, mi_parte=7.5, dia_pago=20, hucha_id="main")
    assert spotify["subscriptions_hucha"] == {"hucha_id": system_id, "monthly_target": 17.99}
    service.update_subscription("owner", subscription_id=spotify["subscription"]["id"], hucha_id=None)
    assert db.doc("huchas", system_id)["objetivo"] == 25.49
    service.update_subscription("owner", subscription_id=netflix["subscription"]["id"], activa=False)
    assert db.doc("huchas", system_id)["objetivo"] == 7.5
    listed = service.list_subscriptions("owner")
    assert listed["monthly_cost"] == 7.5 and {s["nombre"] for s in listed["items"]} == {"Netflix", "Spotify"}
    cancelled = service.cancel_subscription("owner", subscription_id=spotify["subscription"]["id"])["subscription"]
    assert cancelled["cancelando"] is True and cancelled["cancel_at"] > datetime.now(timezone.utc).date().isoformat()
    assert service.cancel_subscription("owner", subscription_id=spotify["subscription"]["id"], undo=True)["subscription"]["cancel_at"] is None
    service.delete_subscription("owner", subscription_id=spotify["subscription"]["id"])
    assert db.doc("huchas", system_id)["objetivo"] is None and db.doc("huchas", system_id)["valor_aportacion"] == 0
    refused(world, "managed_hucha", lambda: service.archive_hucha("owner", hucha_id=system_id))
    refused(world, "managed_hucha", lambda: service.update_hucha("owner", hucha_id=system_id, valor_aportacion=1))


@pytest.mark.parametrize("code,arguments", [
    ("invalid_subscription", {"mi_parte": 20}),
    ("invalid_hucha", {"hucha_id": "theirs"}),
    ("invalid_date", {"fecha_inicio": "2026-02-30"}),
    ("invalid_amount", {"importe": -3}),
])
def test_invalid_subscriptions_write_nothing(world, code, arguments):
    refused(world, code, lambda: world[1].create_subscription("owner", **{"nombre": "Gym", "importe": 10, "dia_pago": 2, **arguments}))


# --- Pending emails and categories ------------------------------------------

def test_approving_a_pending_email_records_it_once_and_hands_it_to_review(world):
    db, service = world
    db.put("correos_pendientes", "gmail-1", {"id_propietario": "owner", "email_id": "gmail-1", "cuerpo": "Cargo de 24,99 EUR", "procesado": False})
    db.put("correos_pendientes", "gmail-x", {"id_propietario": "other", "email_id": "gmail-x", "cuerpo": "Ajeno", "procesado": False})
    assert [e["id"] for e in service.list_pending_emails("owner")["items"]] == ["gmail-1"]
    approve = lambda: service.approve_pending_email("owner", email_id="gmail-1", tipo="gasto", concepto="Discord Nitro", importe=24.99, fecha_operacion="2026-05-22")
    movement = approve()["movement"]
    assert db.doc("movimientos", movement["id"])["id_correo_origen"] == "gmail-1" and balances(db)["main"] == 975.01
    assert db.doc("review_handoffs", movement["id"])["email_id"] == "gmail-1"
    assert db.doc("correos_pendientes", "gmail-1") is None and db.doc("stats", "owner")["total_gastos"] == 3024.99
    refused(world, "not_found", approve)
    refused(world, "not_found", lambda: service.discard_pending_email("owner", email_id="gmail-x"))
    service.discard_pending_email("other", email_id="gmail-x")
    assert db.doc("correos_pendientes", "gmail-x") is None


def test_custom_categories_and_their_wallets(world):
    db, service = world
    category = service.create_category("owner", label="  Mascotas ", tipo="gasto")["category"]
    assert category["label"] == "Mascotas" and db.doc("categorias/owner/items", category["id"])["tipo"] == "gasto"
    refused(world, "duplicate_category", lambda: service.create_category("owner", label="mascotas", tipo="ambos"))
    refused(world, "duplicate_category", lambda: service.create_category("owner", label="Alimentación", tipo="gasto"))
    assert service.set_category_hucha("owner", category=category["id"], hucha_id="trip") == {"category_huchas": {category["id"]: "trip"}, "revision": 1}
    assert expense(service, categoria=category["id"])["movement"]["hucha_id"] == "trip"
    refused(world, "invalid_category", lambda: service.set_category_hucha("owner", category="nomina", hucha_id="trip"))
    refused(world, "not_found", lambda: service.set_category_hucha("owner", category="ocio", hucha_id="theirs"))
    assert service.set_category_hucha("owner", category=category["id"], hucha_id=None) == {"category_huchas": {}, "revision": 2}
    listed = service.list_categories("owner")
    assert {"id": category["id"], "label": "Mascotas", "tipo": "gasto"} in listed["categories"] and listed["category_huchas"] == {}


# --- Reads ------------------------------------------------------------------

def test_listing_filters_pages_and_summaries(world):
    db, service = world
    day = lambda n: (NOW.replace(day=1, hour=12) + timedelta(hours=n)).isoformat()
    expense(service, concepto="Súper Mercadona", importe=50, categoria="alimentacion", fecha_operacion=day(1))
    expense(service, concepto="Cine", importe=20, categoria="ocio", hucha_id="trip", fecha_operacion=day(2))
    service.create_movement("owner", tipo="ingreso", concepto="Nómina", importe=1000, fecha_operacion=day(3), categoria="nomina")
    service.create_cash_withdrawal("owner", hucha_origen_id="main", importe=30, concepto="Cajero", fecha_operacion=day(4))
    first = service.list_movements("owner", limit=2)
    second = service.list_movements("owner", limit=2, cursor=first["next_cursor"])
    third = service.list_movements("owner", limit=2, cursor=second["next_cursor"])
    seen = [m["concepto"] for page in (first, second, third) for m in page["items"]]
    assert len(seen) == 5 and seen[-3:] == ["Nómina", "Cine", "Súper Mercadona"] and third["next_cursor"] is None
    assert [m["concepto"] for m in service.list_movements("owner", text="super")["items"]] == ["Súper Mercadona"]
    assert [m["concepto"] for m in service.list_movements("owner", tipo="gasto", include_internal=False)["items"]] == ["Cine", "Súper Mercadona"]
    assert [m["concepto"] for m in service.list_movements("owner", hucha_id="trip")["items"]] == ["Cine"]
    assert service.list_movements("owner", start_date=day(2), end_date=day(3))["items"][0]["concepto"] == "Cine"
    summary = service.summarize_movements("owner", start_date=day(0), end_date=day(10), group_by="category")
    assert {g["key"]: (g["ingresos"], g["gastos"]) for g in summary["groups"]} == {
        "nomina": (1000.0, 0.0), "alimentacion": (0.0, 50.0), "ocio": (0.0, 20.0)}
    assert summary["totals"] == {"ingresos": 1000.0, "gastos": 70.0} and summary["truncated"] is False
    by_wallet = service.summarize_movements("owner", start_date=day(0), end_date=day(10), group_by="hucha")
    assert {g["label"] for g in by_wallet["groups"]} == {"Cuenta", "Viaje", "Reparto automático"}
    overview = service.get_overview("owner")
    assert overview["current_month"] == {"ingresos": 1000.0, "gastos": 70.0, "neto": 930.0}
    assert overview["total_balance"] == sum(balances(db).values()) and overview["pending_emails"] == 0
    assert [h["id"] for h in overview["huchas"]][:3] == ["main", "trip", "fixed"]


def test_email_history_is_owner_scoped_and_excerpted(world):
    db, service = world
    db.put("correos_historico", "gmail-9", {"id_propietario": "owner", "email_id": "gmail-9", "cuerpo": "x" * 900,
                                           "movimientos_generados": ["m1"], "created_at": NOW})
    db.put("correos_historico", "gmail-z", {"id_propietario": "other", "cuerpo": "ajeno", "created_at": NOW})
    history = service.list_email_history("owner")["items"]
    assert [(e["id"], len(e["excerpt"]), e["truncated"]) for e in history] == [("gmail-9", 400, True)]
    assert len(service.get_email("owner", email_id="gmail-9")["email"]["cuerpo"]) == 900
    refused(world, "not_found", lambda: service.get_email("owner", email_id="gmail-z"))
