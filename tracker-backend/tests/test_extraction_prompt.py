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


# --- Una transferencia de Unicaja llega en dos avisos: se apunta una sola vez ---

TRANSFER_NOTICE = {
    "id": "transfer-mail", "from": "Aviso de Unicaja <no-reply@notifica.unicaja.es>",
    "subject": "Transferencia realizada por importe de 150,00 €",
    "date_sent": "Mon, 23 Nov 2026 07:59:33 +0100",
    "body": "Se ha realizado una transferencia por importe de 150,00 € en concepto de Alquiler.",
}
CHARGE_NOTICE = {
    "id": "charge-mail", "from": "Aviso de Unicaja <no-reply@notifica.unicaja.es>",
    "subject": "Nuevo pago y cargo en tu cuenta por importe de 150,00 EUR",
    "date_sent": "Mon, 23 Nov 2026 07:59:27 +0100",
    "body": "Se ha cargado la cantidad de 150,00 EUR en tu cuenta en concepto de alquiler.",
}


def run_emails(emails, review=False):
    row = bizum_row(importe=150, descripcion="Alquiler")
    with patch.object(main, "get_unread_emails_from_bank", return_value=emails), \
         patch.object(main, "mark_email_as_read", return_value=True) as mark, \
         patch.object(main, "extract_with_gemini", return_value=[row]) as gemini, \
         patch.object(main, "process_email_movements_transaction", return_value=[]) as process, \
         patch.object(main, "review_enabled", return_value=review), \
         patch.object(main, "read_processing", return_value={}), \
         patch.object(main, "record_resolved_branches") as resolved, \
         patch.object(main, "finish_review_handoff") as handoff, \
         patch.object(main, "save_to_pending_review") as pending, \
         patch.object(main, "db") as db:
        db.collection.return_value.document.return_value.get.return_value.exists = False
        main.process_emails()
    return {"mark": mark, "gemini": gemini, "process": process, "resolved": resolved,
            "handoff": handoff, "pending": pending}


def test_transfer_with_two_notices_is_recorded_once():
    calls = run_emails([TRANSFER_NOTICE, CHARGE_NOTICE])
    assert calls["gemini"].call_count == 1
    assert calls["process"].call_count == 1
    [movement] = [m["movimiento"] for m in calls["process"].call_args.args[1]]
    assert movement["importe"] == 150.0 and movement["email_id"] == "charge-mail"
    # The skipped notice is closed, not sent to manual review.
    calls["mark"].assert_any_call("transfer-mail")
    calls["pending"].assert_not_called()


def test_duplicate_transfer_notice_is_closed_in_review_mode():
    calls = run_emails([TRANSFER_NOTICE], review=True)
    calls["gemini"].assert_not_called()
    calls["process"].assert_not_called()
    [call] = calls["resolved"].call_args_list
    assert call.args[2:] == ("transfer-mail", False)
    calls["handoff"].assert_called_once_with(TRANSFER_NOTICE, [])


@pytest.mark.parametrize("email, duplicate", [
    (TRANSFER_NOTICE, True),
    ({**TRANSFER_NOTICE, "subject": "  TRANSFERENCIA REALIZADA por importe de 10,00 €"}, True),
    (CHARGE_NOTICE, False),
    ({**TRANSFER_NOTICE, "subject": "Transferencia recibida por importe de 150,00 €"}, False),
    ({**TRANSFER_NOTICE, "from": "BBVA <avisos@bbva.es>"}, False),
    ({**TRANSFER_NOTICE, "subject": None}, False),
])
def test_only_unicaja_transfer_notices_are_duplicates(email, duplicate):
    assert main.is_duplicate_bank_notice(email) is duplicate
