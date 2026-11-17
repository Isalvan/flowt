from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from firebase_admin import messaging

import main
import push


def snapshot(doc_id, data):
    ref = MagicMock(name=f"ref-{doc_id}")
    return SimpleNamespace(id=doc_id, to_dict=lambda: data, reference=ref)


def fake_db(devices):
    db = MagicMock()
    db.collection.return_value.document.return_value.collection.return_value.stream.return_value = devices
    return db


def test_format_amount_uses_spanish_separators():
    assert push.format_amount(1234.5) == "1.234,50 €"
    assert push.format_amount(-3) == "3,00 €"


def test_single_movement_text():
    assert push.notification_text([{"tipo": "gasto", "importe": 12.3, "concepto": " Mercadona "}]) == (
        "Gasto de 12,30 €", "Mercadona")
    assert push.notification_text([{"tipo": "ingreso", "importe": 1500, "concepto": "Nómina"}])[0] == "Ingreso de 1.500,00 €"


def test_several_movements_are_summarised_and_internal_ones_skipped():
    title, body = push.notification_text([
        {"tipo": "gasto", "importe": 5, "concepto": "Café"},
        {"tipo": "ingreso", "importe": 20, "concepto": "Bizum"},
        {"tipo": "gasto", "importe": 100, "concepto": "Traspaso", "es_interno": True},
    ])
    assert title == "2 movimientos nuevos"
    assert body == "−5,00 € Café · +20,00 € Bizum"
    assert push.notification_text([{"tipo": "gasto", "importe": 1, "es_interno": True}]) is None
    long_body = push.notification_text([{"tipo": "gasto", "importe": 1, "concepto": "x" * 200}] * 3)[1]
    assert len(long_body) == push.MAX_BODY and long_body.endswith("…")


def test_sends_to_every_device_and_drops_dead_tokens():
    alive, dead = snapshot("a", {"token": "tok-a"}), snapshot("b", {"token": "tok-b"})
    db = fake_db([alive, dead, snapshot("c", {})])
    sent = []

    def send(messages):
        sent.extend(messages)
        return SimpleNamespace(success_count=1, responses=[
            SimpleNamespace(success=True, exception=None),
            SimpleNamespace(success=False, exception=messaging.UnregisteredError("gone")),
        ])

    count = push.notify_new_movements(db, "owner", [{"tipo": "gasto", "importe": 9.99, "concepto": "Netflix"}], send=send)
    assert count == 1
    assert [m.token for m in sent] == ["tok-a", "tok-b"]
    assert sent[0].notification.title == "Gasto de 9,99 €"
    assert sent[0].android.notification.channel_id == "movimientos"
    assert sent[0].android.notification.visibility == "private"
    db.collection.assert_called_with("push_tokens")
    db.collection.return_value.document.assert_called_with("owner")
    dead.reference.delete.assert_called_once()
    alive.reference.delete.assert_not_called()


def test_nothing_is_sent_without_devices_or_news():
    send = MagicMock()
    assert push.notify_new_movements(fake_db([]), "owner", [{"tipo": "gasto", "importe": 1}], send=send) == 0
    assert push.notify_new_movements(fake_db([snapshot("a", {"token": "t"})]), "owner", [], send=send) == 0
    send.assert_not_called()


def test_tracker_survives_a_failing_push():
    with patch.object(main, "notify_new_movements", side_effect=RuntimeError("fcm down")) as notify:
        main.notify_owner([{"tipo": "gasto", "importe": 1, "concepto": "x"}])
    notify.assert_called_once()
    with patch.object(main, "notify_new_movements") as notify:
        main.notify_owner([])
    notify.assert_not_called()
