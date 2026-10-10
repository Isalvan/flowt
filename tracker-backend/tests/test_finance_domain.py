"""Wallet arithmetic used by the finance tools, without any storage."""
import hashlib
from datetime import date, datetime, timezone

import pytest

from finance import domain as d
from reviews.domain import ReviewError


def wallets(**overrides):
    huchas = {
        "main": {"nombre": "Cuenta", "tipo_aportacion": "resto", "es_principal": True, "saldo_acumulado": 1000, "orden": 1},
        "trip": {"nombre": "Viaje", "tipo_aportacion": "porcentaje", "valor_aportacion": 10, "saldo_acumulado": 200,
                 "objetivo": 250, "tope_objetivo": True, "orden": 2},
        "fixed": {"nombre": "Fijos", "tipo_aportacion": "flat", "valor_aportacion": 100, "saldo_acumulado": 0, "orden": 3},
    }
    for key, changes in overrides.items():
        huchas[key] = {**huchas.get(key, {}), **changes}
    return huchas


def test_income_fills_fixed_then_percentage_then_rest_and_respects_caps():
    split = d.distribute_income(100_000, wallets())
    # The trip wallet would take 10 % (100 €) but only 50 € fit under its capped goal.
    assert split == {"saldos": {"fixed": 10_000, "trip": 5_000, "main": 85_000}, "deudas": {}}


def test_plain_split_ignores_caps_like_the_web_reversal():
    assert d.distribute_income(100_000, wallets(), plain=True)["saldos"] == {"fixed": 10_000, "trip": 10_000, "main": 80_000}


def test_small_income_never_hands_out_more_than_it_has():
    split = d.distribute_income(6_000, wallets())
    assert split["saldos"] == {"fixed": 6_000}
    assert sum(split["saldos"].values()) == 6_000


def test_wallet_in_debt_repays_its_lender_first():
    split = d.distribute_income(100_000, wallets(fixed={"deuda_pendiente": 30, "deuda_con": "main"}))
    assert split["deudas"] == {"fixed": {"importe": 3_000, "con": "main"}}
    assert split["saldos"] == {"fixed": 7_000, "trip": 5_000, "main": 88_000}


def test_archived_and_cash_wallets_receive_no_income():
    split = d.distribute_income(50_000, wallets(fixed={"activa": False}, cash={"es_metalico": True, "tipo_aportacion": "flat", "valor_aportacion": 20, "orden": 0}))
    assert set(split["saldos"]) == {"trip", "main"}


def test_percentages_over_one_hundred_are_refused():
    with pytest.raises(ReviewError) as error:
        d.distribute_income(10_000, wallets(extra={"tipo_aportacion": "porcentaje", "valor_aportacion": 95, "orden": 4}))
    assert error.value.code == "invalid_distribution"


def test_recorded_split_is_undone_exactly_even_after_rules_change():
    huchas = wallets(fixed={"deuda_pendiente": 30, "deuda_con": "main"})
    movement = {"tipo": "ingreso", "importe": 1000, "reparto_aplicado": d.recorded_split(d.distribute_income(100_000, huchas))}
    changed = wallets(fixed={"valor_aportacion": 999})
    assert d.income_reversal(movement, changed) == {
        "saldos": {"fixed": -7_000, "trip": -5_000, "main": -88_000},
        "deudas": {"fixed": {"importe": 3_000, "con": "main"}}}


def test_reversal_of_a_legacy_income_recomputes_and_spares_archived_wallets():
    reversal = d.income_reversal({"tipo": "ingreso", "importe": 1000}, wallets())
    assert reversal == {"saldos": {"fixed": -10_000, "trip": -10_000, "main": -80_000}, "deudas": {}}
    recorded = {"tipo": "ingreso", "importe": 100, "reparto_aplicado": {"saldos": {"fixed": 100}, "deudas": {}}}
    assert d.income_reversal(recorded, wallets(fixed={"activa": False}))["saldos"] == {"main": -10_000}


def test_expense_and_rest_fallbacks():
    assert d.expense_hucha(wallets()) == "main"
    assert d.fallback_hucha(wallets(), exclude=("main",)) == "trip"
    assert d.expense_hucha({"cash": {"es_metalico": True}}) is None


def test_compensation_link_and_unlink_round_trip():
    gasto = {"id": "g", "tipo": "gasto", "importe": 45}
    ingreso = {"id": "i", "tipo": "ingreso", "importe": 22.5}
    updates = d.compensation_updates(gasto, [(ingreso, 2_250)])
    assert updates["g"] == {"compensado_por_detalles": [{"ingreso_id": "i", "importe": 22.5}], "importe_neto": 22.5}
    assert updates["i"] == {"compensaciones_destinos": [{"gasto_id": "g", "importe": 22.5}]}
    linked_gasto, linked_ingreso = {**gasto, **updates["g"]}, {**ingreso, **updates["i"]}
    assert d.available(linked_gasto) == 2_250 and d.available(linked_ingreso) == 0
    assert d.linked_ids(linked_gasto) == ["i"]
    undone = d.unlink_updates(linked_gasto, [linked_ingreso])
    assert undone["g"] == {"compensado_por_detalles": None, "compensado_por": None, "importe_neto": None}
    assert undone["i"] == {"compensaciones_destinos": None, "compensa_movimiento_id": None}


@pytest.mark.parametrize("other,amount", [
    ({"id": "x", "tipo": "gasto", "importe": 10}, 500),          # same type
    ({"id": "i", "tipo": "ingreso", "importe": 10}, 1_500),       # more than the income has
    ({"id": "i", "tipo": "ingreso", "importe": 10, "es_interno": True}, 500),
    ({"id": "i", "tipo": "ingreso", "importe": 100}, 5_000),      # more than the expense has
])
def test_invalid_compensations_are_refused(other, amount):
    with pytest.raises(ReviewError):
        d.compensation_updates({"id": "g", "tipo": "gasto", "importe": 45}, [(other, amount)])


def test_subscription_target_counts_only_what_the_system_wallet_covers():
    subscriptions = [
        {"activa": True, "importe": 17.99, "frecuencia": "mensual", "hucha_id": "system"},
        {"activa": True, "importe": 14.99, "mi_parte": 7.5, "frecuencia": "mensual"},
        {"activa": True, "importe": 49.9, "frecuencia": "anual", "hucha_id": "system"},
        {"activa": True, "importe": 30, "frecuencia": "mensual", "hucha_id": "elsewhere"},
        {"activa": False, "importe": 99, "frecuencia": "mensual"},
    ]
    assert d.subscriptions_target(subscriptions, "system") == 29.65


def test_next_charge_follows_anchor_cadence_and_short_months():
    monthly = {"frecuencia": "mensual", "dia_pago": 31, "fecha_inicio": "2026-01-31"}
    assert d.next_charge(monthly, date(2026, 2, 1)) == date(2026, 2, 28)
    assert d.next_charge(monthly, date(2026, 2, 28), include_today=False) == date(2026, 3, 31)
    quarterly = {"frecuencia": "trimestral", "dia_pago": 5, "fecha_inicio": "2026-01-05"}
    assert d.next_charge(quarterly, date(2026, 1, 6)) == date(2026, 4, 5)
    legacy = {"frecuencia": "anual", "dia_pago": 12, "created_at": datetime(2025, 3, 20, tzinfo=timezone.utc)}
    assert d.next_charge(legacy, date(2026, 3, 13)) == date(2027, 3, 12)


def test_custom_category_id_matches_the_web_digest():
    assert d.custom_category_id("Café  ", "gasto") != d.custom_category_id("Cafe", "ingreso")
    assert d.custom_category_id("Café", "gasto") == "custom_" + hashlib.sha256(b"cafe:gasto").hexdigest()


def test_dates_and_amounts_are_validated():
    assert d.parse_moment("2026-10-09") == datetime(2026, 10, 9, tzinfo=timezone.utc)
    assert d.parse_moment("2026-10-09T10:00:00+02:00").utcoffset().total_seconds() == 7200
    for bad in ["ayer", "2026-13-01", 20261009, None]:
        with pytest.raises(ReviewError):
            d.parse_moment(bad)
    assert d.amount_cents(12.345) == 1235
    for bad in [0, -1, True, "x", float("nan"), 10_000_000]:
        with pytest.raises(ReviewError):
            d.amount_cents(bad)
    assert d.clean_text("  Mercadona\x00\n ", 200) == "Mercadona"
