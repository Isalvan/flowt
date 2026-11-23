"""Prompt de Gemini para correos del banco: fechas ISO, categorías y Bizum/transferencias enviados."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

import ai_parser
import main
from category_suggestions import category_fields
from fallback_logic import fallback_extract_movement


def test_prompt_and_schema_ask_for_iso_dates():
    prompt, schema = ai_parser.load_prompt_configuration()
    assert "starting with YYYY-MM-DD" in prompt
    assert "Never return a time without an offset" in prompt
    assert "YYYY-MM-DD" in schema["items"]["properties"]["fecha"]["description"]


def test_category_fields_are_in_the_property_ordering():
    _, schema = ai_parser.load_prompt_configuration()
    ordering = schema["items"]["propertyOrdering"]
    assert ordering[-2:] == ["categoria_sugerida", "categoria_confianza"]
    assert len(ordering) == len(set(ordering))
    assert not {"categoria_sugerida", "categoria_confianza"} & set(schema["items"]["required"])


def test_loader_adds_category_ordering_to_an_older_schema_file(tmp_path, monkeypatch):
    prompts = tmp_path / "prompts"
    prompts.mkdir()
    old = json.loads(json.dumps(ai_parser.TRANSACTION_SCHEMA))
    old["items"]["propertyOrdering"] = old["items"]["propertyOrdering"][:-2]
    (prompts / "response_schema.json").write_text(json.dumps(old), encoding="utf-8")
    monkeypatch.setattr(ai_parser, "__file__", str(tmp_path / "ai_parser.py"))
    _, schema = ai_parser.load_prompt_configuration()
    assert schema["items"]["propertyOrdering"][-2:] == ["categoria_sugerida", "categoria_confianza"]


def test_built_in_fallback_prompt_is_used_when_files_are_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_parser, "__file__", str(tmp_path / "ai_parser.py"))
    prompt, schema = ai_parser.load_prompt_configuration()
    assert prompt.startswith(ai_parser.SYSTEM_INSTRUCTION)
    assert schema["items"]["propertyOrdering"].count("categoria_sugerida") == 1


def test_prompt_mentions_categories_before_the_category_section():
    prompt, _ = ai_parser.load_prompt_configuration()
    assert "fill categoria_sugerida and categoria_confianza for every extracted transaction" in prompt
    assert prompt.count("CATEGORY SUGGESTIONS") == 2  # the pointer and the section itself


def test_outgoing_bizum_and_transfers_are_extracted_as_uncategorized_expenses():
    prompt, _ = ai_parser.load_prompt_configuration()
    assert "Outgoing transfers or Bizum without an explicit spending purpose" not in prompt
    assert "Generic outgoing Bizum is not a transaction to extract" not in prompt
    assert "outgoing Bizum or outgoing transfer to another person or business is gasto, whether or not it states a purpose" in prompt
    assert "is alta even without a stated purpose" in prompt
    assert "outgoing transfer or Bizum without an explicit spending purpose, use sin_categorizar" in prompt
    # Still excluded.
    assert "Transfers between the user's own accounts or wallets" in prompt
    assert "Pending, scheduled, reversed, cancelled" in prompt
    assert "es_retirada_efectivo true" in prompt
    # sin_categorizar leaves the movement without a suggestion, so it shows as uncategorized.
    assert category_fields({"tipo": "gasto", "categoria_sugerida": "sin_categorizar", "categoria_confianza": "baja"}) == {}


def test_fallback_keeps_an_outgoing_bizum_as_an_expense():
    [movement] = fallback_extract_movement(
        "Has enviado un Bizum de 15,00 EUR a JUAN PEREZ.", "Mon, 23 Nov 2026 08:00:00 +0100"
    )
    assert movement["tipo"] == "gasto"
    assert movement["importe"] == 15.0
    assert movement["es_retirada_efectivo"] is False


def run_one_email(mock_gemini_rows):
    """Process one bank email through main.process_emails and return the stored movements."""
    email = {"id": "bizum-mail", "from": "test@bank.com",
             "date_sent": "Mon, 23 Nov 2026 08:00:00 +0100", "body": "Bizum enviado de 15,00 EUR"}
    with patch.object(main, "get_unread_emails_from_bank", return_value=[email]), \
         patch.object(main, "mark_email_as_read", return_value=True), \
         patch.object(main, "extract_with_gemini", return_value=mock_gemini_rows), \
         patch.object(main, "process_email_movements_transaction", return_value=[]) as process, \
         patch.object(main, "review_enabled", return_value=False), \
         patch.object(main, "db") as db:
        db.collection.return_value.document.return_value.get.return_value.exists = False
        main.process_emails()
    return [m["movimiento"] for m in process.call_args.args[1]]


def bizum_row(**extra):
    return {"tipo": "gasto", "importe": 15, "moneda": "EUR", "fecha": "2026-11-23",
            "descripcion": "Bizum a Juan Perez", "confianza": "alta", "es_retirada_efectivo": False,
            "categoria_sugerida": "sin_categorizar", "categoria_confianza": "baja", **extra}


def test_generic_outgoing_bizum_is_stored_as_an_uncategorized_expense():
    [movement] = run_one_email([bizum_row()])
    assert movement["tipo"] == "gasto"
    assert movement["importe"] == 15.0
    assert movement["concepto"] == "Bizum a Juan Perez"
    assert movement["es_interno"] is False
    assert "categoria_sugerida" not in movement
    assert movement["version_prompt"] == "v2"


@pytest.mark.parametrize("fecha, expected", [
    ("2026-11-23", datetime(2026, 11, 23, tzinfo=timezone.utc)),
    ("2026-11-23T07:45:00+01:00", datetime(2026, 11, 23, 7, 45, tzinfo=timezone(timedelta(hours=1)))),
])
def test_iso_dates_from_the_prompt_are_stored_as_given(fecha, expected):
    [movement] = run_one_email([bizum_row(fecha=fecha)])
    assert movement["fecha_operacion"] == expected
    assert movement["fecha_operacion"].tzinfo is not None
