from datetime import date, datetime, timezone
from unittest.mock import MagicMock

import main


def test_subscription_cancellation_date_uses_persisted_date():
    subscription = {
        "cancelando": True,
        "cancel_at": "2026-08-15",
        "dia_pago": 15,
        "frecuencia": "mensual",
    }
    assert main.subscription_cancellation_date(subscription, date(2026, 7, 18)) == date(2026, 8, 15)


def test_legacy_cancellation_uses_update_time_and_real_cycle():
    subscription = {
        "cancelando": True,
        "updated_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
        "fecha_inicio": "2026-07-31",
        "dia_pago": 31,
        "frecuencia": "anual",
    }
    assert main.subscription_cancellation_date(subscription) == date(2027, 7, 31)


def test_routes_recognized_charge_to_configured_hucha():
    movement = {"concepto": "Pago NETFLIX.COM", "importe": 17.99}
    subscriptions = [{"nombre": "Netflix", "importe": 17.99, "hucha_id": "subscriptions"}]
    huchas = {"subscriptions": {"data": {"es_suscripciones": True}}}
    assert main.find_subscription_hucha(movement, subscriptions, huchas, "subscriptions") == "subscriptions"


def test_does_not_guess_when_an_amount_matches_multiple_subscriptions():
    movement = {"concepto": "Cargo con tarjeta", "importe": 9.99}
    subscriptions = [
        {"nombre": "Servicio A", "importe": 9.99, "hucha_id": "subscriptions"},
        {"nombre": "Servicio B", "importe": 9.99, "hucha_id": "subscriptions"},
    ]
    huchas = {"subscriptions": {"data": {"es_suscripciones": True}}}
    assert main.find_subscription_hucha(movement, subscriptions, huchas, "subscriptions") is None


def test_scheduled_cleanup_deletes_and_recalculates_wallet(monkeypatch):
    expired = MagicMock(id="expired", reference="expired-ref")
    expired.to_dict.return_value = {
        "activa": True, "cancelando": True, "cancel_at": "2026-07-18",
        "importe": 12, "frecuencia": "mensual", "hucha_id": "subscriptions",
    }
    active = MagicMock(id="active", reference="active-ref")
    active.to_dict.return_value = {
        "activa": True, "importe": 60, "mi_parte": 30,
        "frecuencia": "semestral", "hucha_id": "subscriptions",
    }
    hucha = MagicMock(id="subscriptions", reference="hucha-ref")
    hucha.to_dict.return_value = {"es_suscripciones": True}

    subscriptions_collection = MagicMock()
    subscriptions_collection.where.return_value.stream.return_value = [expired, active]
    huchas_collection = MagicMock()
    huchas_collection.where.return_value.stream.return_value = [hucha]
    fake_db = MagicMock()
    fake_db.collection.side_effect = lambda name: {
        "suscripciones": subscriptions_collection,
        "huchas": huchas_collection,
    }[name]
    monkeypatch.setattr(main, "db", fake_db)

    assert main.process_expired_subscriptions("owner", date(2026, 7, 18)) == 1
    fake_db.batch.return_value.delete.assert_called_once_with("expired-ref")
    update = fake_db.batch.return_value.update.call_args.args[1]
    assert update["valor_aportacion"] == 5.0
    fake_db.batch.return_value.commit.assert_called_once()
