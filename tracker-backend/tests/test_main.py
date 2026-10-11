import os
import json
import hashlib
import pytest
from unittest.mock import patch, MagicMock

import main
from finance.domain import amount_cents, distribute_income, euros, recorded_split

@pytest.mark.parametrize("sender,expected", [
    ("Alertas <INFO@REVOLUT.COM>", "Revolut"),
    ("avisos@unicaja.es", "Unicaja"),
    ("avisos@bbva.es", "BBVA"),
    ("avisos@santander.es", "Santander"),
    ("avisos@caixa.es", "CaixaBank"),
    ("avisos@ing.es", "ING"),
    ("avisos@sabadell.es", "Sabadell"),
    ("avisos@n26.com", "N26"),
    ("no-reply@traderepublic.com", "Trade Republic"),
    ("unknown@example.com", "Banco"),
    ("", "Banco"),
    ("revolut-unicaja@example.com", "Revolut"),
])
def test_infer_bank_from_sender(sender, expected):
    assert main.infer_bank_from_sender(sender) == expected

@pytest.fixture(autouse=True)
def mock_config():
    # Setup test environment variables
    with patch.dict(os.environ, {
        "BANK_SENDER": "test@bank.com",
        "UID_PROPIETARIO": "test_user_123",
        "AI_MODEL": "test-model"
    }):
        # Mock Firebase initialization
        with patch("main.firebase_admin.initialize_app"), \
             patch("main.firestore.client") as mock_firestore_client:
            
            # Setup a consistent collection mock
            mock_collection = MagicMock()
            mock_firestore_client.collection.return_value = mock_collection
            
            main.setup_config()
            # Ensure global db is set
            main.db = mock_firestore_client
            yield mock_firestore_client, mock_collection

@pytest.fixture
def mock_gmail_client():
    with patch("main.get_unread_emails_from_bank") as mock_get, \
         patch("main.mark_email_as_read") as mock_mark:
        yield mock_get, mock_mark

@pytest.fixture
def mock_gemini():
    with patch("main.extract_with_gemini") as mock_extract:
        yield mock_extract

def test_process_emails_success(mock_config, mock_gmail_client, mock_gemini):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    mock_get.return_value = [
        {
            "id": "msg-123",
            "message_id": "<test-msg-1@bank.com>",
            "from": "test@bank.com",
            "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200",
            "body": "Ingreso de 100 EUR"
        }
    ]
    mock_gemini.return_value = [
        {"tipo": "ingreso", "importe": 100.0, "fecha": "2026-04-11", "descripcion": "Ingreso", "moneda": "EUR", "confianza": "alta"}
    ]
    
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_snapshot = MagicMock()
    mock_snapshot.exists = False
    mock_doc.get.return_value = mock_snapshot
    
    mock_transaction = MagicMock()
    mock_firestore.transaction.return_value = mock_transaction
    
    mock_hucha_doc = MagicMock()
    mock_hucha_doc.id = "hucha-1"
    mock_hucha_doc.reference = MagicMock(name="hucha-1-ref")
    mock_hucha_doc.to_dict.return_value = {
        "tipo_aportacion": "resto",
        "saldo_acumulado": 50.0,
        "es_principal": True
    }
    
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_doc]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    mock_mark.return_value = True
    
    main.process_emails()
    
    expected_unique_id = "msg-123_0"
    expected_doc_id = hashlib.sha256(expected_unique_id.encode()).hexdigest()
    
    mock_collection.document.assert_any_call(expected_doc_id)
    mock_collection.document.assert_any_call("msg-123")
    mock_mark.assert_called_once_with("msg-123")

def test_setup_config_normalizes_multiple_bank_senders(mock_config):
    with patch.dict(os.environ, {
        "BANK_SENDER": " Alertas@Unicaja.es, info@Revolut.com ",
        "UID_PROPIETARIO": "test_user_123",
        "AI_MODEL": "test-model",
    }):
        main.setup_config()

    assert main.ALLOWED_BANK_SENDERS == frozenset({
        "alertas@unicaja.es",
        "info@revolut.com",
    })

def test_process_emails_rejects_sender_outside_exact_allowlist(
    mock_config, mock_gmail_client, mock_gemini
):
    mock_get, mock_mark = mock_gmail_client
    mock_get.return_value = [{
        "id": "spoofed",
        "from": "info@revolut.com.attacker.test",
        "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200",
        "body": "Ingreso 100 EUR",
    }]

    with patch.object(main, "BANK_SENDER", "alertas@unicaja.es,info@revolut.com"), \
         patch.object(main, "ALLOWED_BANK_SENDERS", frozenset({
             "alertas@unicaja.es",
             "info@revolut.com",
         })):
        main.process_emails()

    mock_gemini.assert_not_called()
    mock_mark.assert_not_called()

def test_process_emails_accepts_second_sender_in_allowlist(
    mock_config, mock_gmail_client, mock_gemini
):
    mock_get, _ = mock_gmail_client
    mock_get.return_value = [{
        "id": "revolut-message",
        "from": "Revolut <INFO@REVOLUT.COM>",
        "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200",
        "body": "Aviso sin movimientos",
    }]
    mock_gemini.return_value = []

    with patch.object(main, "BANK_SENDER", "alertas@unicaja.es,info@revolut.com"), \
         patch.object(main, "ALLOWED_BANK_SENDERS", frozenset({
             "alertas@unicaja.es",
             "info@revolut.com",
         })):
        main.process_emails()

    mock_gemini.assert_called_once()

def test_process_multiple_movements_success(mock_config, mock_gmail_client, mock_gemini):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    mock_get.return_value = [
        {
            "id": "multi-msg",
            "message_id": "<multi@bank.com>",
            "from": "test@bank.com",
            "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200",
            "body": "Dos cargos de 10.0 y 20.0"
        }
    ]
    mock_gemini.return_value = [
        {"tipo": "gasto", "importe": 10.0, "fecha": "2026-04-11", "descripcion": "Gasto 1", "moneda": "EUR", "confianza": "alta"},
        {"tipo": "gasto", "importe": 20.0, "fecha": "2026-04-11", "descripcion": "Gasto 2", "moneda": "EUR", "confianza": "alta"}
    ]
    
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_snapshot = MagicMock()
    mock_snapshot.exists = False
    mock_doc.get.return_value = mock_snapshot
    
    mock_transaction = MagicMock()
    mock_firestore.transaction.return_value = mock_transaction
    
    mock_hucha_doc = MagicMock()
    mock_hucha_doc.id = "hucha-1"
    mock_hucha_doc.reference = MagicMock(name="hucha-1-ref")
    mock_hucha_doc.to_dict.return_value = {
        "tipo_aportacion": "resto",
        "saldo_acumulado": 50.0,
        "es_principal": True
    }
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_doc]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    mock_mark.return_value = True
    
    main.process_emails()
    
    expected_doc_id_0 = hashlib.sha256(b"multi-msg_0").hexdigest()
    expected_doc_id_1 = hashlib.sha256(b"multi-msg_1").hexdigest()
    
    mock_collection.document.assert_any_call(expected_doc_id_0)
    mock_collection.document.assert_any_call(expected_doc_id_1)
    mock_collection.document.assert_any_call("multi-msg")
    mock_mark.assert_called_once_with("multi-msg")

def test_process_income_resto_decoupling(mock_config, mock_gmail_client, mock_gemini):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    mock_get.return_value = [{"id": "inc-1", "message_id": "m1", "from": "test@bank.com", "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200", "body": "Ingreso 100.0"}]
    mock_gemini.return_value = [{"tipo": "ingreso", "importe": 100.0, "fecha": "2026-04-11", "descripcion": "I", "moneda": "EUR", "confianza": "alta"}]
    
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_doc.get.return_value.exists = False
    
    mock_hucha_principal = MagicMock()
    mock_hucha_principal.id = "h-principal"
    mock_hucha_principal.reference = MagicMock(name="h-principal-ref")
    mock_hucha_principal.to_dict.return_value = {"tipo_aportacion": "flat", "valor_aportacion": 0, "es_principal": True, "saldo_acumulado": 0}
    
    mock_hucha_resto = MagicMock()
    mock_hucha_resto.id = "h-resto"
    mock_hucha_resto.reference = MagicMock(name="h-resto-ref")
    mock_hucha_resto.to_dict.return_value = {"tipo_aportacion": "resto", "es_principal": False, "saldo_acumulado": 0}
    
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_principal, mock_hucha_resto]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    main.process_emails()
    
    mock_firestore.transaction.return_value.update.assert_any_call(
        mock_hucha_resto.reference,
        {"saldo_acumulado": 100.0, "updated_at": main.firestore.SERVER_TIMESTAMP}
    )

def test_process_expense_principal_decoupling(mock_config, mock_gmail_client, mock_gemini):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    mock_get.return_value = [{"id": "exp-1", "message_id": "m2", "from": "test@bank.com", "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200", "body": "Gasto 50.0"}]
    mock_gemini.return_value = [{"tipo": "gasto", "importe": 50.0, "fecha": "2026-04-11", "descripcion": "G", "moneda": "EUR", "confianza": "alta"}]
    
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_doc.get.return_value.exists = False
    
    mock_hucha_principal = MagicMock()
    mock_hucha_principal.id = "h-principal"
    mock_hucha_principal.reference = MagicMock(name="h-principal-ref")
    mock_hucha_principal.to_dict.return_value = {"tipo_aportacion": "flat", "valor_aportacion": 0, "es_principal": True, "saldo_acumulado": 100}
    
    mock_hucha_resto = MagicMock()
    mock_hucha_resto.id = "h-resto"
    mock_hucha_resto.reference = MagicMock(name="h-resto-ref")
    mock_hucha_resto.to_dict.return_value = {"tipo_aportacion": "resto", "es_principal": False, "saldo_acumulado": 100}
    
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_principal, mock_hucha_resto]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    main.process_emails()
    
    mock_firestore.transaction.return_value.update.assert_any_call(
        mock_hucha_principal.reference,
        {"saldo_acumulado": 50.0, "updated_at": main.firestore.SERVER_TIMESTAMP}
    )

def test_process_expense_subscription_routing(mock_config, mock_gmail_client, mock_gemini):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    mock_get.return_value = [{"id": "exp-sub", "message_id": "m3", "from": "test@bank.com", "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200", "body": "Pago Netflix 15.0"}]
    mock_gemini.return_value = [{"tipo": "gasto", "importe": 15.0, "fecha": "2026-04-11", "descripcion": "Pago Netflix", "moneda": "EUR", "confianza": "alta"}]
    
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_doc.get.return_value.exists = False
    
    mock_hucha_subs = MagicMock()
    mock_hucha_subs.id = "h-subs"
    mock_hucha_subs.reference = MagicMock(name="h-subs-ref")
    mock_hucha_subs.to_dict.return_value = {"es_suscripciones": True, "saldo_acumulado": 200.0}
    
    mock_hucha_principal = MagicMock()
    mock_hucha_principal.id = "h-principal"
    mock_hucha_principal.reference = MagicMock(name="h-principal-ref")
    mock_hucha_principal.to_dict.return_value = {"es_principal": True, "saldo_acumulado": 100.0}
    
    mock_sub = MagicMock()
    mock_sub.to_dict.return_value = {"nombre": "Netflix", "importe": 15.0, "hucha_id": "h-subs", "activa": True}
    
    mock_query_huchas = MagicMock()
    mock_query_huchas.stream.return_value = [mock_hucha_subs, mock_hucha_principal]
    
    mock_query_subs = MagicMock()
    mock_query_subs.stream.return_value = [mock_sub]
    
    def where_side_effect(field, op, val):
        q = MagicMock()
        if field == "id_propietario":
            q.order_by.return_value = mock_query_huchas
            q.where.return_value.stream.return_value = [mock_sub]
        return q
    
    mock_collection.where.side_effect = where_side_effect
    
    main.process_emails()
    
    mock_firestore.transaction.return_value.update.assert_any_call(
        mock_hucha_subs.reference,
        {"saldo_acumulado": 185.0, "updated_at": main.firestore.SERVER_TIMESTAMP}
    )

def test_process_expense_resto_fallback_routing(mock_config, mock_gmail_client, mock_gemini):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    mock_get.return_value = [{"id": "exp-fallback", "message_id": "m4", "from": "test@bank.com", "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200", "body": "Gasto vario 30.0"}]
    mock_gemini.return_value = [{"tipo": "gasto", "importe": 30.0, "fecha": "2026-04-11", "descripcion": "Gasto vario", "moneda": "EUR", "confianza": "alta"}]
    
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_doc.get.return_value.exists = False
    
    mock_hucha_resto = MagicMock()
    mock_hucha_resto.id = "h-resto"
    mock_hucha_resto.reference = MagicMock(name="h-resto-ref")
    mock_hucha_resto.to_dict.return_value = {"tipo_aportacion": "resto", "es_principal": False, "saldo_acumulado": 100.0}
    
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_resto]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    main.process_emails()
    
    mock_firestore.transaction.return_value.update.assert_any_call(
        mock_hucha_resto.reference,
        {"saldo_acumulado": 70.0, "updated_at": main.firestore.SERVER_TIMESTAMP}
    )

def test_validate_parsed_data():
    assert main.validate_parsed_data({"tipo": "gasto", "importe": 50.0, "fecha": "2024-10-25"}, "Gasto de 50.0") == True
    assert main.validate_parsed_data({"tipo": "invalid", "importe": 50.0, "fecha": "2024-10-25"}, "50.0") == False
    assert main.validate_parsed_data({"tipo": "gasto", "importe": "not a number", "fecha": "2024-10-25"}, "test") == False
    assert main.validate_parsed_data({}, "") == False

def test_parse_amount():
    from fallback_logic import parse_amount
    assert parse_amount("4,42") == 4.42
    assert parse_amount("4.42") == 4.42
    assert parse_amount("12,50") == 12.50
    assert parse_amount("12.50") == 12.50
    assert parse_amount("1.200,50") == 1200.50
    assert parse_amount("1,200.50") == 1200.50
    assert parse_amount("1.200") == 1200.0
    assert parse_amount("5.000") == 5000.0
    assert parse_amount("120") == 120.0

def test_gmail_webhook_missing_env_vars(mock_config):
    with patch("main.BANK_SENDER", None), patch("main.UID_PROPIETARIO", None):
        request = MagicMock()
        request.method = "POST"
        response, status = main.gmail_webhook(request)
        assert status == 500

def test_gmail_webhook_missing_token(mock_config):
    with patch.dict(os.environ, {}, clear=True), patch("main.BANK_SENDER", "x"), patch("main.UID_PROPIETARIO", "y"):
        request = MagicMock()
        request.method = "POST"
        response, status = main.gmail_webhook(request)
        assert status == 500

def test_gmail_webhook_invalid_method(mock_config):
    with patch.dict(os.environ, {"WEBHOOK_TOKEN": "my-secret-token"}), patch("main.BANK_SENDER", "x"), patch("main.UID_PROPIETARIO", "y"):
        request = MagicMock()
        request.method = "GET"
        response, status = main.gmail_webhook(request)
        assert status == 405

def test_gmail_webhook_unauthorized(mock_config):
    with patch.dict(os.environ, {"WEBHOOK_TOKEN": "my-secret-token"}), patch("main.BANK_SENDER", "x"), patch("main.UID_PROPIETARIO", "y"):
        request = MagicMock()
        request.method = "POST"
        request.headers.get.return_value = "Bearer wrong-token"
        response, status = main.gmail_webhook(request)
        assert status == 401

@patch("main.process_emails")
def test_gmail_webhook_authorized(mock_process, mock_config):
    with patch.dict(os.environ, {"WEBHOOK_TOKEN": "my-secret-token"}), patch("main.BANK_SENDER", "x"), patch("main.UID_PROPIETARIO", "y"):
        request = MagicMock()
        request.method = "POST"
        request.headers.get.return_value = "Bearer my-secret-token"
        response, status = main.gmail_webhook(request)
        assert status == 200
        mock_process.assert_called_once()


def hucha_doc(doc_id, **data):
    doc = MagicMock()
    doc.id = doc_id
    doc.reference = MagicMock(name=f"{doc_id}-ref")
    doc.to_dict.return_value = data
    return doc


def process_income_email(mock_config, huchas, amounts):
    """Run one email transaction with distinct movement, stats and wallet references."""
    mock_firestore, mock_collection = mock_config
    references = {}

    def document(doc_id=None):
        doc_id = doc_id or "new-main"
        if doc_id not in references:
            references[doc_id] = MagicMock(name=f"{doc_id}-ref")
            references[doc_id].id = doc_id
        return references[doc_id]

    mock_collection.document.side_effect = document
    document("test_user_123").get.return_value.to_dict.return_value = {}
    mock_collection.where.return_value.order_by.return_value.stream.return_value = huchas
    mock_collection.where.return_value.where.return_value.stream.return_value = []
    mock_firestore.get_all.return_value = []
    movements = [{"doc_id": f"income-{index}", "movimiento": {
        "tipo": "ingreso", "importe": amount, "id_propietario": "test_user_123",
        "concepto": "Ingreso", "fecha_operacion": "2026-04-11",
    }} for index, amount in enumerate(amounts)]
    transaction = mock_firestore.transaction.return_value
    with patch.object(main, "review_enabled", return_value=False):
        recorded = main.process_email_movements_transaction.to_wrap(
            transaction, movements, "test_user_123", email_id="income-email",
        )
    assert recorded == [movement["doc_id"] for movement in movements]
    wallet_refs = {hucha.reference: hucha.id for hucha in huchas}
    updates = {wallet_refs[call.args[0]]: call.args[1]
               for call in transaction.update.call_args_list if call.args[0] in wallet_refs}
    if "new-main" in references:
        updates["new-main"] = next(call.args[1] for call in transaction.set.call_args_list
                                   if call.args[0] is references["new-main"])
    saved = {movement["doc_id"]: next(
        call.args[1] for call in transaction.set.call_args_list
        if call.args[0] is references[movement["doc_id"]]
    ) for movement in movements}
    stats = next(call.args[1] for call in transaction.set.call_args_list
                 if call.args[0] is references["test_user_123"])
    return updates, saved, stats


def test_email_income_matches_domain_and_records_split(mock_config):
    huchas = [
        hucha_doc("fixed", orden=1, tipo_aportacion="flat", valor_aportacion=30,
                  saldo_acumulado=10, objetivo=35, tope_objetivo=True),
        hucha_doc("percentage", orden=2, tipo_aportacion="porcentaje", valor_aportacion=25,
                  saldo_acumulado=2),
        hucha_doc("rest", orden=3, tipo_aportacion="resto", saldo_acumulado=5),
    ]
    data = {hucha.id: hucha.to_dict() for hucha in huchas}
    expected = distribute_income(amount_cents(100.03), data)
    updates, saved, stats = process_income_email(mock_config, huchas, [100.03])
    assert {hid: update["saldo_acumulado"] for hid, update in updates.items()} == {
        hid: round(data[hid]["saldo_acumulado"] + euros(delta), 2)
        for hid, delta in expected["saldos"].items()
    }
    assert saved["income-0"]["reparto_aplicado"] == recorded_split(expected)
    assert stats["total_ingresos"] == 100.03


@pytest.mark.parametrize("kind,rule", [("flat", 100), ("porcentaje", 100)])
def test_second_email_income_respects_the_cap_filled_by_the_first(mock_config, kind, rule):
    huchas = [
        hucha_doc("capped", orden=1, tipo_aportacion=kind, valor_aportacion=rule,
                  saldo_acumulado=10, objetivo=50, tope_objetivo=True),
        hucha_doc("rest", orden=2, tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates, saved, stats = process_income_email(mock_config, huchas, [40, 30])
    assert updates["capped"]["saldo_acumulado"] == 50
    assert updates["rest"]["saldo_acumulado"] == 30
    assert saved["income-0"]["reparto_aplicado"] == {"saldos": {"capped": 40.0}, "deudas": {}}
    assert saved["income-1"]["reparto_aplicado"] == {"saldos": {"rest": 30.0}, "deudas": {}}
    assert stats["total_ingresos"] == 70


def test_email_income_repays_lender_and_records_debt_reduction(mock_config):
    huchas = [
        hucha_doc("debtor", orden=1, tipo_aportacion="flat", valor_aportacion=40,
                  saldo_acumulado=0, deuda_pendiente=60, deuda_con="rest"),
        hucha_doc("rest", orden=2, tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates, saved, _ = process_income_email(mock_config, huchas, [50])
    assert updates["debtor"]["saldo_acumulado"] == 0
    assert updates["debtor"]["deuda_pendiente"] == 20
    assert "deuda_con" not in updates["debtor"]
    assert updates["rest"]["saldo_acumulado"] == 50
    assert saved["income-0"]["reparto_aplicado"] == {
        "saldos": {"rest": 50.0}, "deudas": {"debtor": {"importe": 40.0, "con": "rest"}},
    }


def test_second_email_income_uses_the_remaining_debt(mock_config):
    huchas = [
        hucha_doc("debtor", orden=1, tipo_aportacion="flat", valor_aportacion=40,
                  saldo_acumulado=0, deuda_pendiente=60, deuda_con="rest"),
        hucha_doc("rest", orden=2, tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates, saved, _ = process_income_email(mock_config, huchas, [50, 50])
    assert updates["debtor"]["saldo_acumulado"] == 20
    assert updates["debtor"]["deuda_pendiente"] == 0
    assert updates["debtor"]["deuda_con"] == main.firestore.DELETE_FIELD
    assert updates["rest"]["saldo_acumulado"] == 80
    assert saved["income-1"]["reparto_aplicado"] == {
        "saldos": {"rest": 30.0, "debtor": 20.0},
        "deudas": {"debtor": {"importe": 20.0, "con": "rest"}},
    }


def test_cash_wallet_receives_no_email_income(mock_config):
    huchas = [
        hucha_doc("cash", orden=1, tipo_aportacion="flat", valor_aportacion=100,
                  saldo_acumulado=20, es_metalico=True, es_principal=True),
        hucha_doc("rest", orden=2, tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates, saved, _ = process_income_email(mock_config, huchas, [100])
    assert "cash" not in updates
    assert updates["rest"]["saldo_acumulado"] == 100
    assert saved["income-0"]["reparto_aplicado"] == {"saldos": {"rest": 100.0}, "deudas": {}}


def test_invalid_email_income_distribution_still_records_movement_and_stats(mock_config):
    huchas = [
        hucha_doc("percentage", tipo_aportacion="porcentaje", valor_aportacion=101, saldo_acumulado=20),
        hucha_doc("rest", tipo_aportacion="resto", saldo_acumulado=30),
    ]
    with patch.object(main.logger, "error") as log_error:
        updates, saved, stats = process_income_email(mock_config, huchas, [100])
    assert updates == {}
    assert saved["income-0"]["importe"] == 100
    assert "reparto_aplicado" not in saved["income-0"]
    assert stats["total_ingresos"] == 100
    log_error.assert_called_once_with("Total percentage (101%) exceeds 100%. Income not distributed.")


@pytest.mark.parametrize("failure", ["invalid_distribution", "no_hucha"])
def test_email_income_retry_does_not_keep_a_previous_split(mock_config, failure):
    huchas = [hucha_doc("wallet", tipo_aportacion="porcentaje", valor_aportacion=50, saldo_acumulado=0)]
    _, saved, _ = process_income_email(mock_config, huchas, [100])
    assert "reparto_aplicado" in saved["income-0"]
    if failure == "invalid_distribution":
        huchas[0].to_dict.return_value["valor_aportacion"] = 101
    else:
        huchas[0].to_dict.return_value["es_metalico"] = True
    mock_firestore, _ = mock_config
    transaction = mock_firestore.transaction.return_value
    transaction.reset_mock()
    with patch.object(main, "review_enabled", return_value=False):
        recorded = main.process_email_movements_transaction.to_wrap(
            transaction, [{"doc_id": "income-0", "movimiento": saved["income-0"]}], "test_user_123",
        )
    assert recorded == ["income-0"]
    assert "reparto_aplicado" not in saved["income-0"]
    transaction.update.assert_not_called()


def test_email_income_with_only_cash_still_records_movement_and_stats(mock_config):
    huchas = [hucha_doc("cash", tipo_aportacion="resto", saldo_acumulado=20, es_metalico=True)]
    with patch.object(main.logger, "error") as log_error:
        updates, saved, stats = process_income_email(mock_config, huchas, [100])
    assert updates == {}
    assert saved["income-0"]["importe"] == 100
    assert "reparto_aplicado" not in saved["income-0"]
    assert stats["total_ingresos"] == 100
    log_error.assert_called_once_with("No eligible huchas found for user test_user_123. Income not distributed.")


def test_email_income_writes_whole_cents_for_half_of_three_cents(mock_config):
    huchas = [
        hucha_doc("percentage", orden=1, tipo_aportacion="porcentaje", valor_aportacion=50, saldo_acumulado=0),
        hucha_doc("rest", orden=2, tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates, saved, _ = process_income_email(mock_config, huchas, [0.03])
    assert updates["percentage"]["saldo_acumulado"] == 0.02
    assert updates["rest"]["saldo_acumulado"] == 0.01
    assert saved["income-0"]["reparto_aplicado"] == {
        "saldos": {"percentage": 0.02, "rest": 0.01}, "deudas": {},
    }


def test_email_income_rounds_written_balance_and_pending_debt(mock_config):
    huchas = [
        hucha_doc("debtor", orden=1, tipo_aportacion="flat", valor_aportacion=0.03,
                  saldo_acumulado=0.001, deuda_pendiente=0.045, deuda_con="rest"),
        hucha_doc("rest", orden=2, tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates, saved, _ = process_income_email(mock_config, huchas, [0.03])
    assert updates["debtor"]["saldo_acumulado"] == 0
    assert updates["debtor"]["deuda_pendiente"] == 0.02
    assert updates["rest"]["saldo_acumulado"] == 0.03
    assert saved["income-0"]["reparto_aplicado"]["deudas"]["debtor"]["importe"] == 0.03


def test_email_income_does_not_repay_debt_to_itself(mock_config):
    huchas = [hucha_doc("rest", tipo_aportacion="resto", saldo_acumulado=0,
                        deuda_pendiente=20, deuda_con="rest")]
    updates, saved, _ = process_income_email(mock_config, huchas, [100])
    assert updates["rest"]["saldo_acumulado"] == 100
    assert "deuda_pendiente" not in updates["rest"]
    assert saved["income-0"]["reparto_aplicado"] == {"saldos": {"rest": 100.0}, "deudas": {}}


def test_email_incomes_create_main_wallet_and_keep_accumulated_balance(mock_config):
    updates, saved, stats = process_income_email(mock_config, [], [20, 30])
    assert updates["new-main"]["es_principal"] is True
    assert updates["new-main"]["saldo_acumulado"] == 50
    assert saved["income-0"]["hucha_id"] == "new-main"
    assert saved["income-0"]["reparto_aplicado"] == {"saldos": {"new-main": 20.0}, "deudas": {}}
    assert saved["income-1"]["reparto_aplicado"] == {"saldos": {"new-main": 30.0}, "deudas": {}}
    assert stats["total_ingresos"] == 50


def process_single_movement(mock_config, mock_gmail_client, mock_gemini, tipo, importe, huchas):
    """Run the synchroniser over one bank email and return the wallet updates by reference."""
    mock_get, _ = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    mock_get.return_value = [{"id": f"mail-{tipo}", "message_id": "m", "from": "test@bank.com",
                              "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200", "body": f"Movimiento {importe}"}]
    mock_gemini.return_value = [{"tipo": tipo, "importe": importe, "fecha": "2026-04-11", "descripcion": "M",
                                 "moneda": "EUR", "confianza": "alta"}]
    mock_collection.document.return_value.get.return_value.exists = False
    mock_query = MagicMock()
    mock_query.stream.return_value = huchas
    mock_collection.where.return_value.order_by.return_value = mock_query
    main.process_emails()
    references = {hucha.reference: hucha.id for hucha in huchas}
    return {references[call.args[0]]: call.args[1]
            for call in mock_firestore.transaction.return_value.update.call_args_list if call.args[0] in references}


def test_archived_wallets_receive_no_income(mock_config, mock_gmail_client, mock_gemini):
    huchas = [
        hucha_doc("h-fija-archivada", tipo_aportacion="flat", valor_aportacion=30, saldo_acumulado=0, activa=False),
        hucha_doc("h-porcentaje-archivada", tipo_aportacion="porcentaje", valor_aportacion=40, saldo_acumulado=0, activa=False),
        hucha_doc("h-viaje", tipo_aportacion="porcentaje", valor_aportacion=10, saldo_acumulado=0, activa=True),
        hucha_doc("h-resto", tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates = process_single_movement(mock_config, mock_gmail_client, mock_gemini, "ingreso", 100.0, huchas)
    assert updates == {
        "h-viaje": {"saldo_acumulado": 10.0, "updated_at": main.firestore.SERVER_TIMESTAMP},
        "h-resto": {"saldo_acumulado": 90.0, "updated_at": main.firestore.SERVER_TIMESTAMP},
    }


def test_archived_wallets_do_not_block_income_when_their_percentages_exceed_the_limit(mock_config, mock_gmail_client, mock_gemini):
    huchas = [
        hucha_doc("h-archivada", tipo_aportacion="porcentaje", valor_aportacion=95, saldo_acumulado=0, activa=False),
        hucha_doc("h-viaje", tipo_aportacion="porcentaje", valor_aportacion=10, saldo_acumulado=0),
        hucha_doc("h-resto", tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates = process_single_movement(mock_config, mock_gmail_client, mock_gemini, "ingreso", 100.0, huchas)
    assert {key: value["saldo_acumulado"] for key, value in updates.items()} == {"h-viaje": 10.0, "h-resto": 90.0}


def test_archived_rest_wallet_is_not_the_income_fallback(mock_config, mock_gmail_client, mock_gemini):
    huchas = [
        hucha_doc("h-resto-archivado", tipo_aportacion="resto", saldo_acumulado=0, activa=False),
        hucha_doc("h-principal", tipo_aportacion="flat", valor_aportacion=0, es_principal=True, saldo_acumulado=5),
    ]
    updates = process_single_movement(mock_config, mock_gmail_client, mock_gemini, "ingreso", 100.0, huchas)
    assert updates == {"h-principal": {"saldo_acumulado": 105.0, "updated_at": main.firestore.SERVER_TIMESTAMP}}


def test_archived_main_wallet_is_not_charged_expenses(mock_config, mock_gmail_client, mock_gemini):
    huchas = [
        hucha_doc("h-principal-archivada", tipo_aportacion="flat", valor_aportacion=0, es_principal=True, saldo_acumulado=0, activa=False),
        hucha_doc("h-resto", tipo_aportacion="resto", es_principal=False, saldo_acumulado=100),
    ]
    updates = process_single_movement(mock_config, mock_gmail_client, mock_gemini, "gasto", 30.0, huchas)
    assert updates == {"h-resto": {"saldo_acumulado": 70.0, "updated_at": main.firestore.SERVER_TIMESTAMP}}


def test_debt_is_repaid_to_an_active_lender(mock_config, mock_gmail_client, mock_gemini):
    huchas = [
        hucha_doc("h-fija", tipo_aportacion="flat", valor_aportacion=40, saldo_acumulado=0, deuda_pendiente=20, deuda_con="h-resto"),
        hucha_doc("h-resto", tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates = process_single_movement(mock_config, mock_gmail_client, mock_gemini, "ingreso", 100.0, huchas)
    assert updates == {
        "h-fija": {"saldo_acumulado": 20.0, "updated_at": main.firestore.SERVER_TIMESTAMP,
                   "deuda_pendiente": 0.0, "deuda_con": main.firestore.DELETE_FIELD},
        "h-resto": {"saldo_acumulado": 80.0, "updated_at": main.firestore.SERVER_TIMESTAMP},
    }


@pytest.mark.parametrize("lender", [
    [hucha_doc("h-prestamista", tipo_aportacion="flat", valor_aportacion=0, saldo_acumulado=0, activa=False)],
    [],
], ids=["archived lender", "missing lender"])
def test_debt_to_an_unavailable_lender_stays_pending_and_no_money_is_lost(mock_config, mock_gmail_client, mock_gemini, lender):
    huchas = lender + [
        hucha_doc("h-fija", tipo_aportacion="flat", valor_aportacion=40, saldo_acumulado=0, deuda_pendiente=20, deuda_con="h-prestamista"),
        hucha_doc("h-resto", tipo_aportacion="resto", saldo_acumulado=0),
    ]
    updates = process_single_movement(mock_config, mock_gmail_client, mock_gemini, "ingreso", 100.0, huchas)
    assert updates == {
        "h-fija": {"saldo_acumulado": 40.0, "updated_at": main.firestore.SERVER_TIMESTAMP},
        "h-resto": {"saldo_acumulado": 60.0, "updated_at": main.firestore.SERVER_TIMESTAMP},
    }
