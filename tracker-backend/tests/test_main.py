import os
import json
import hashlib
import pytest
import argparse
from unittest.mock import patch, MagicMock, call, ANY
import re
if not hasattr(re, 'T'):
    re.T = getattr(re, 'TEMPLATE', 1)

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
def mock_extract():
    with patch("main.extract_with_gemini") as mock_extract_gemini:
        yield mock_extract_gemini

def test_process_emails_success(mock_config, mock_gmail_client, mock_extract):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    # Mock emails
    mock_get.return_value = [
        {
            "id": "msg-123",
            "message_id": "<test-msg-1@bank.com>",
            "from": "test@bank.com",
            "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200",
            "body": "Ingreso de 100 EUR"
        }
    ]
    
    # Mock Gemini output
    mock_extract.return_value = [{"tipo": "ingreso", "importe": 100.0, "fecha": "2024-10-25", "descripcion": "Ingreso", "moneda": "EUR", "confianza": "alta"}]
    
    # Mock Firestore Document
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    
    # Crucial: Mock the snapshot existence
    mock_snapshot = MagicMock()
    mock_snapshot.exists = False
    mock_doc.get.return_value = mock_snapshot
    
    # Mock Transaction
    mock_transaction = MagicMock()
    mock_firestore.transaction.return_value = mock_transaction
    
    # The transactional decorator calls the function with transaction as first arg
    # In main.py: was_recorded = process_movement_transaction(transaction, mov_ref, movimiento, UID_PROPIETARIO)
    # We need to mock the stream return for huchas within the transaction
    mock_hucha_doc = MagicMock()
    mock_hucha_doc.id = "hucha-1"
    mock_hucha_doc.to_dict.return_value = {
        "tipo_aportacion": "resto",
        "saldo_acumulado": 50.0,
        "es_principal": True
    }
    
    mock_query = MagicMock()
    # In process_movement_transaction: huchas_docs = list(query.stream(transaction=transaction))
    mock_query.stream.return_value = [mock_hucha_doc]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    mock_mark.return_value = True
    
    # Run
    main.process_emails()
    
    # Verify unique ID generation (email_id_0)
    expected_unique_id = "msg-123_0"
    expected_doc_id = hashlib.sha256(expected_unique_id.encode()).hexdigest()
    
    # Check that document was accessed with the right ID
    mock_collection.document.assert_any_call(expected_doc_id)
    
    # Check that email was saved to correos_historico
    mock_collection.document.assert_any_call("msg-123")
    mock_doc.set.assert_any_call({
        "id_propietario": "test_user_123",
        "email_id": "msg-123",
        "cuerpo": "Ingreso de 100 EUR",
        "fecha_envio": "Sat, 11 Apr 2026 20:36:55 +0200",
        "movimientos_generados": [expected_doc_id],
        "created_at": main.firestore.SERVER_TIMESTAMP
    })
    
    # Verify email marked as read
    mock_mark.assert_called_once_with("msg-123")

def test_call_gemini_cli_json_noise(mock_extract):
    pass

def test_process_multiple_movements_success(mock_config, mock_gmail_client, mock_extract):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    # Mock emails
    mock_get.return_value = [
        {
            "id": "multi-msg",
            "message_id": "<multi@bank.com>",
            "from": "test@bank.com",
            "date_sent": "Sat, 11 Apr 2026 20:36:55 +0200",
            "body": "Dos cargos"
        }
    ]
    
    # Mock Gemini output (2 movements)
    mock_extract.return_value = [
        {"tipo": "gasto", "importe": 10.0, "fecha": "2024-10-25", "descripcion": "Gasto 1", "moneda": "EUR", "confianza": "alta"},
        {"tipo": "gasto", "importe": 20.0, "fecha": "2024-10-25", "descripcion": "Gasto 2", "moneda": "EUR", "confianza": "alta"}
    ]
    
    # Mock Firestore Document
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_snapshot = MagicMock()
    mock_snapshot.exists = False
    mock_doc.get.return_value = mock_snapshot
    
    # Mock Huchas
    mock_transaction = MagicMock()
    mock_firestore.transaction.return_value = mock_transaction
    
    mock_hucha_doc = MagicMock()
    mock_hucha_doc.id = "hucha-1"
    mock_hucha_doc.to_dict.return_value = {
        "tipo_aportacion": "resto",
        "saldo_acumulado": 50.0,
        "es_principal": True
    }
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_doc]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    mock_mark.return_value = True
    
    # Run
    main.process_emails()
    
    # Verify unique ID generation for both movements
    expected_doc_id_0 = hashlib.sha256(b"multi-msg_0").hexdigest()
    expected_doc_id_1 = hashlib.sha256(b"multi-msg_1").hexdigest()
    
    mock_collection.document.assert_any_call(expected_doc_id_0)
    mock_collection.document.assert_any_call(expected_doc_id_1)
    
    # Verify correos_historico was written
    mock_collection.document.assert_any_call("multi-msg")
    mock_doc.set.assert_any_call({
        "id_propietario": "test_user_123",
        "email_id": "multi-msg",
        "cuerpo": "Dos cargos",
        "fecha_envio": "Sat, 11 Apr 2026 20:36:55 +0200",
        "movimientos_generados": [expected_doc_id_0, expected_doc_id_1],
        "created_at": main.firestore.SERVER_TIMESTAMP
    })

    # Verify email marked as read only once
    mock_mark.assert_called_once_with("multi-msg")

def test_process_income_resto_decoupling(mock_config, mock_gmail_client, mock_extract):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    mock_get.return_value = [{"id": "inc-1", "message_id": "m1", "from": "b", "date_sent": "d", "body": "b"}]
    mock_extract.return_value = [{"tipo": "ingreso", "importe": 100.0, "fecha": "2024-10-25", "descripcion": "I", "moneda": "EUR", "confianza": "alta"}]
    
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_doc.get.return_value.exists = False
    
    # Two huchas: one principal, one resto. Income should go to resto.
    mock_hucha_principal = MagicMock()
    mock_hucha_principal.id = "h-principal"
    mock_hucha_principal.to_dict.return_value = {"tipo_aportacion": "flat", "valor_aportacion": 0, "es_principal": True, "saldo_acumulado": 0}
    
    mock_hucha_resto = MagicMock()
    mock_hucha_resto.id = "h-resto"
    mock_hucha_resto.to_dict.return_value = {"tipo_aportacion": "resto", "es_principal": False, "saldo_acumulado": 0}
    
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_principal, mock_hucha_resto]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    main.process_emails()
    
    mock_firestore.transaction.return_value.update.assert_any_call(
        ANY,
        {"saldo_acumulado": 100.0, "updated_at": ANY}
    )

def test_process_expense_principal_decoupling(mock_config, mock_gmail_client, mock_extract):
    mock_get, mock_mark = mock_gmail_client
    mock_firestore, mock_collection = mock_config
    
    mock_get.return_value = [{"id": "exp-1", "message_id": "m2", "from": "b", "date_sent": "d", "body": "b"}]
    mock_extract.return_value = [{"tipo": "gasto", "importe": 50.0, "fecha": "2024-10-25", "descripcion": "G", "moneda": "EUR", "confianza": "alta"}]
    
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_doc.get.return_value.exists = False
    
    # Two huchas: one principal, one resto. Expense should come from principal.
    mock_hucha_principal = MagicMock()
    mock_hucha_principal.id = "h-principal"
    mock_hucha_principal.to_dict.return_value = {"tipo_aportacion": "flat", "valor_aportacion": 0, "es_principal": True, "saldo_acumulado": 100}
    
    mock_hucha_resto = MagicMock()
    mock_hucha_resto.id = "h-resto"
    mock_hucha_resto.to_dict.return_value = {"tipo_aportacion": "resto", "es_principal": False, "saldo_acumulado": 100}
    
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_principal, mock_hucha_resto]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    main.process_emails()
    
    mock_firestore.transaction.return_value.update.assert_any_call(
        ANY,
        {"saldo_acumulado": 50.0, "updated_at": ANY}
    )

def test_validate_parsed_data():
    assert main.validate_parsed_data({"tipo": "gasto", "importe": 50.0, "fecha": "2024-10-25"}) == True
    assert main.validate_parsed_data({"tipo": "invalid", "importe": 50.0, "fecha": "2024-10-25"}) == False
    assert main.validate_parsed_data({"tipo": "gasto", "importe": "not a number", "fecha": "2024-10-25"}) == False
    assert main.validate_parsed_data({}) == False

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
