import os
import json
import hashlib
import pytest
from unittest.mock import patch, MagicMock, call

# Set environment variables before importing main
os.environ["BANK_SENDER"] = "test@bank.com"
os.environ["UID_PROPIETARIO"] = "test_user_123"

import main

@pytest.fixture
def mock_gmail_client():
    with patch("main.get_unread_emails_from_bank") as mock_get, \
         patch("main.mark_email_as_read") as mock_mark:
        yield mock_get, mock_mark

@pytest.fixture
def mock_subprocess():
    with patch("main.subprocess.Popen") as mock_popen:
        yield mock_popen

@pytest.fixture
def mock_firestore():
    with patch("main.db") as mock_db:
        yield mock_db

def test_process_emails_success(mock_gmail_client, mock_subprocess, mock_firestore):
    mock_get, mock_mark = mock_gmail_client
    
    # Mock emails
    mock_get.return_value = [
        {
            "id": "msg-1",
            "message_id": "<test-msg-1@bank.com>",
            "from": "test@bank.com",
            "body": "Ingreso de 100 EUR"
        }
    ]
    
    # Mock Gemini output
    mock_process = MagicMock()
    mock_process.communicate.return_value = (
        '```json\n{"tipo": "ingreso", "importe": 100.0, "fecha": "2024-10-25", "descripcion": "Ingreso"}\n```',
        ''
    )
    mock_process.returncode = 0
    mock_subprocess.return_value = mock_process
    
    # Mock Firestore
    mock_collection = MagicMock()
    mock_firestore.collection.return_value = mock_collection
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    
    # Mock Huchas
    mock_transaction = MagicMock()
    mock_firestore.transaction.return_value = mock_transaction
    
    mock_hucha_doc1 = MagicMock()
    mock_hucha_doc1.id = "hucha-1"
    mock_hucha_doc1.to_dict.return_value = {
        "tipo_aportacion": "flat",
        "valor_aportacion": 20.0,
        "saldo_acumulado": 50.0
    }
    
    mock_hucha_doc2 = MagicMock()
    mock_hucha_doc2.id = "hucha-2"
    mock_hucha_doc2.to_dict.return_value = {
        "tipo_aportacion": "porcentaje",
        "valor_aportacion": 10.0,
        "saldo_acumulado": 100.0
    }
    
    mock_hucha_doc3 = MagicMock()
    mock_hucha_doc3.id = "hucha-3"
    mock_hucha_doc3.to_dict.return_value = {
        "tipo_aportacion": "resto",
        "saldo_acumulado": 200.0
    }
    
    mock_query = MagicMock()
    mock_query.stream.return_value = [mock_hucha_doc1, mock_hucha_doc2, mock_hucha_doc3]
    mock_collection.where.return_value.order_by.return_value = mock_query
    
    mock_mark.return_value = True
    
    # Run
    main.process_emails()
    
    # Verify SHA-256 ID generation
    expected_doc_id = hashlib.sha256(b"<test-msg-1@bank.com>").hexdigest()
    mock_collection.document.assert_any_call(expected_doc_id)
    
    # Verify movement was saved
    mock_doc.set.assert_called_once()
    saved_data = mock_doc.set.call_args[0][0]
    assert saved_data["tipo"] == "ingreso"
    assert saved_data["importe"] == 100.0
    
    # Verify huchas distribution
    # Flat: 20.0
    # Percentage: 10% of 100 = 10.0
    # Resto: 100 - 20 - 10 = 70.0
    
    # Check transaction updates
    assert mock_transaction.update.call_count == 3
    
    # Verify email marked as read
    mock_mark.assert_called_once_with("msg-1")

def test_process_emails_invalid_sender(mock_gmail_client, mock_subprocess, mock_firestore):
    mock_get, mock_mark = mock_gmail_client
    
    mock_get.return_value = [
        {
            "id": "msg-2",
            "message_id": "<test-msg-2@other.com>",
            "from": "other@bank.com",
            "body": "Spam"
        }
    ]
    
    main.process_emails()
    
    # Should not call Gemini or Firestore
    mock_subprocess.assert_not_called()
    mock_firestore.collection.assert_not_called()
    mock_mark.assert_not_called()

def test_process_emails_gemini_failure(mock_gmail_client, mock_subprocess, mock_firestore):
    mock_get, mock_mark = mock_gmail_client
    
    mock_get.return_value = [
        {
            "id": "msg-3",
            "message_id": "<test-msg-3@bank.com>",
            "from": "test@bank.com",
            "body": "Gasto de 50 EUR"
        }
    ]
    
    mock_process = MagicMock()
    mock_process.communicate.return_value = ('', 'Error')
    mock_process.returncode = 1
    mock_subprocess.return_value = mock_process
    
    main.process_emails()
    
    # Should not call Firestore or mark as read
    mock_firestore.collection.assert_not_called()
    mock_mark.assert_not_called()

def test_process_emails_firestore_failure(mock_gmail_client, mock_subprocess, mock_firestore):
    mock_get, mock_mark = mock_gmail_client
    
    mock_get.return_value = [
        {
            "id": "msg-4",
            "message_id": "<test-msg-4@bank.com>",
            "from": "test@bank.com",
            "body": "Gasto de 50 EUR"
        }
    ]
    
    mock_process = MagicMock()
    mock_process.communicate.return_value = (
        '```json\n{"tipo": "gasto", "importe": 50.0, "fecha": "2024-10-25", "descripcion": "Gasto"}\n```',
        ''
    )
    mock_process.returncode = 0
    mock_subprocess.return_value = mock_process
    
    mock_collection = MagicMock()
    mock_firestore.collection.return_value = mock_collection
    mock_doc = MagicMock()
    mock_collection.document.return_value = mock_doc
    mock_doc.set.side_effect = Exception("Firestore error")
    
    main.process_emails()
    
    # Should not mark as read
    mock_mark.assert_not_called()
