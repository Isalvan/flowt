from datetime import datetime, timezone

import pytest

from finance import domain as d
from .test_finance_service import world


@pytest.mark.parametrize("movement,expected", [
    ({"categoria": "nomina", "concepto": "Ingreso"}, True),
    ({"categoria_sugerida": "nomina"}, True),
    ({"concepto": "Abono NÓMINA de agosto"}, True),
    ({"concepto": "SALARIO"}, True),
    ({"concepto": "Pago de sueldo."}, True),
    ({"concepto": "prenomina"}, False),
    ({"concepto": "nominas"}, False),
    ({"concepto": "nomina_extra"}, False),
    ({"categoria": "otros", "categoria_sugerida": "nomina", "concepto": "Nómina"}, False),
    ({"categoria_sugerida": "otros", "concepto": "Nómina"}, False),
    ({"categoria": "", "categoria_sugerida": "nomina"}, True),
    ({}, False),
])
def test_is_payroll(movement, expected):
    assert d.is_payroll(movement) is expected


@pytest.mark.parametrize("value,expected", [
    ("2026-08-01", "2026-08"),
    ("2026-07-31T22:30:00Z", "2026-08"),
    ("2026-11-30T23:30:00Z", "2026-12"),
    ("2026-08-01T00:30:00+03:00", "2026-07"),
    ("2026-07-31T22:30:00", "2026-08"),
    (datetime(2026, 7, 31, 22, 30, tzinfo=timezone.utc), "2026-08"),
    (datetime(2026, 7, 31, 22, 30), "2026-08"),
    ("2026-02-30", None),
    ("2026-08-01T24:00:00Z", None),
    ("2026-08-01T12:00:00+00:60", None),
    ("invalid", None),
    (None, None),
])
def test_extra_month(value, expected):
    assert d.extra_month({"categoria": "nomina", "fecha_operacion": value}) == expected
    assert d.extra_month({"concepto": "Regalo", "fecha_operacion": value}) is None


def test_record_and_reverse_preserve_extras():
    wallets = {"personal": {"tipo_aportacion": "flat", "extra_importe": 100, "extra_meses": [8]},
               "rest": {"tipo_aportacion": "resto"}}
    split = d.distribute_income(20000, wallets, extra_month="2026-08")
    recorded = d.recorded_split(split)
    assert recorded == {"saldos": {"personal": 100, "rest": 100}, "deudas": {}, "extras": {"personal": "2026-08"}}
    assert d.income_reversal({"importe": 200, "reparto_aplicado": recorded}, wallets) == {
        "saldos": {"personal": -10000, "rest": -10000}, "deudas": {}, "extras": {"personal": "2026-08"}}


def configure(db):
    db.data[("huchas", "fixed")].update(extra_importe=100, extra_meses=[8, 12])


def payroll(service, **fields):
    return service.create_movement("owner", tipo="ingreso", concepto="Nómina", importe=1000,
                                   fecha_operacion="2026-08-01", **fields)["movement"]


def test_service_applies_once_delete_allows_reapply(world):
    db, service = world
    configure(db)
    first = payroll(service)
    assert db.doc("huchas", "fixed")["extra_ultimo"] == "2026-08"
    assert db.doc("huchas", "fixed")["saldo_acumulado"] == 200
    assert first["reparto_aplicado"]["extras"] == {"fixed": "2026-08"}
    second = payroll(service)
    assert "extras" not in second["reparto_aplicado"]
    service.delete_movement("owner", movement_id=first["id"])
    assert "extra_ultimo" not in db.doc("huchas", "fixed")
    assert payroll(service)["reparto_aplicado"]["extras"] == {"fixed": "2026-08"}


def test_service_old_reversal_preserves_newer_month(world):
    db, service = world
    configure(db)
    first = payroll(service)
    service.create_movement("owner", tipo="ingreso", concepto="Nómina", importe=1000, fecha_operacion="2026-12-01")
    service.delete_movement("owner", movement_id=first["id"])
    assert db.doc("huchas", "fixed")["extra_ultimo"] == "2026-12"


@pytest.mark.parametrize("fields", [{"concepto": "Regalo"}, {"concepto": "Nómina", "hucha_id": "fixed"}])
def test_service_non_payroll_and_directed_income_have_no_extra(world, fields):
    db, service = world
    configure(db)
    service.create_movement("owner", tipo="ingreso", importe=1000, fecha_operacion="2026-08-01", **fields)
    assert "extra_ultimo" not in db.doc("huchas", "fixed")


def test_service_pending_approval_applies_and_delete_clears(world):
    db, service = world
    configure(db)
    db.put("correos_pendientes", "pending", {"id_propietario": "owner", "email_id": "mail"})
    created = service.approve_pending_email("owner", email_id="pending", tipo="ingreso", concepto="Nómina",
                                           importe=1000, fecha_operacion="2026-08-01")
    assert db.doc("huchas", "fixed")["extra_ultimo"] == "2026-08"
    service.delete_movement("owner", movement_id=created["movement"]["id"])
    assert "extra_ultimo" not in db.doc("huchas", "fixed")


@pytest.mark.parametrize("manual", [False, True])
def test_service_conversion_and_reversal(world, manual):
    db, service = world
    configure(db)
    created = service.create_movement("owner", tipo="gasto", concepto="Nómina", importe=1000,
                                      fecha_operacion="2026-08-01", hucha_id="main")
    mid = created["movement"]["id"]
    service.convert_movement("owner", movement_id=mid,
                             distribution=[{"hucha_id": "fixed", "importe": 1000}] if manual else None)
    assert db.doc("huchas", "fixed").get("extra_ultimo") == (None if manual else "2026-08")
    service.convert_movement("owner", movement_id=mid, target_hucha_id="main")
    assert "extra_ultimo" not in db.doc("huchas", "fixed")
