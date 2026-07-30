import os
import json
import hashlib
import pytest
from unittest.mock import patch, MagicMock

import main

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
