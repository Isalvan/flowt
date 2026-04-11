import os
import json
import hashlib
import pytest
import argparse
from unittest.mock import patch, MagicMock, call

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
def mock_subprocess():
    with patch("main.subprocess.Popen") as mock_popen:
        yield mock_popen

def test_process_emails_success(mock_config, mock_gmail_client, mock_subprocess):
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
    
    # Mock Gemini output (multiple movements)
    mock_process = MagicMock()
    mock_process.communicate.return_value = (
        '[{"tipo": "ingreso", "importe": 100.0, "fecha": "2024-10-25", "descripcion": "Ingreso", "moneda": "EUR", "confianza": "alta"}]',
        ''
    )
    mock_process.returncode = 0
    mock_subprocess.return_value = mock_process
    
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
    
    # Verify email marked as read
    mock_mark.assert_called_once_with("msg-123")

def test_call_gemini_cli_json_noise(mock_subprocess):
    # Mock Gemini output with noise (as seen in the user's log)
    noise_output = """
    MCP issues detected. Run /mcp list for status.[{"tipo":"gasto","importe":25.5,"moneda":"EUR","fecha":"2025-10-25","descripcion":"Cargo","confianza":"alta"}]
    Created execution plan for SessionEnd: 1 hook(s) to execute in parallel
    """
    
    mock_process = MagicMock()
    mock_process.communicate.return_value = (noise_output, '')
    mock_process.returncode = 0
    mock_subprocess.return_value = mock_process
    
    with patch("main.shutil.which", return_value="/path/to/gemini"):
        with patch("main.open", MagicMock()):
            result = main.call_gemini_cli("body", "date")
            
    assert result == [{"tipo":"gasto","importe":25.5,"moneda":"EUR","fecha":"2025-10-25","descripcion":"Cargo","confianza":"alta"}]

def test_process_multiple_movements_success(mock_config, mock_gmail_client, mock_subprocess):
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
    mock_process = MagicMock()
    mock_process.communicate.return_value = (
        '[{"tipo": "gasto", "importe": 10.0, "fecha": "2024-10-25", "descripcion": "Gasto 1", "moneda": "EUR", "confianza": "alta"},'
        ' {"tipo": "gasto", "importe": 20.0, "fecha": "2024-10-25", "descripcion": "Gasto 2", "moneda": "EUR", "confianza": "alta"}]',
        ''
    )
    mock_process.returncode = 0
    mock_subprocess.return_value = mock_process
    
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
    
    # Verify email marked as read only once
    mock_mark.assert_called_once_with("multi-msg")

def test_validate_parsed_data():
    assert main.validate_parsed_data({"tipo": "gasto", "importe": 50.0, "fecha": "2024-10-25"}) == True
    assert main.validate_parsed_data({"tipo": "invalid", "importe": 50.0, "fecha": "2024-10-25"}) == False
    assert main.validate_parsed_data({"tipo": "gasto", "importe": "not a number", "fecha": "2024-10-25"}) == False
    assert main.validate_parsed_data({}) == False
