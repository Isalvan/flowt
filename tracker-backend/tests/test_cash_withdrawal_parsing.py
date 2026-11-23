"""Un reintegro en cajero se extrae como paso de dinero a Efectivo, no como gasto."""
import pytest

import ai_parser
from fallback_logic import fallback_extract_movement, is_cash_withdrawal


@pytest.mark.parametrize("text", [
    "Se ha realizado un reintegro en cajero de 50,00 EUR con su tarjeta.",
    "Retirada de efectivo de 20,00 EUR en el cajero de Plaza Mayor.",
    "Ha autorizado una operación de 60,00 EUR en CAJERO UNICAJA CENTRO.",
    "Disposición de efectivo a crédito: 30,00 EUR.",
    "Operación en cajero automático por 10,00 EUR.",
])
def test_fallback_recognises_cash_withdrawals(text):
    assert is_cash_withdrawal(text)
    [movement] = fallback_extract_movement(text, "Fri, 20 Nov 2026 10:00:00 +0100")
    assert movement["tipo"] == "gasto"
    assert movement["es_retirada_efectivo"] is True
    assert movement["es_interno"] is True
    assert movement["descripcion"] == "[RESCUE] Reintegro en cajero"


@pytest.mark.parametrize("text", [
    "Ha autorizado una operación de 12,50 EUR en MERCADONA.",
    "Se ha recibido un ingreso en efectivo en cajero de 100,00 EUR.",
    "Encuentra tu cajero más cercano. Compra de 9,99 EUR en NETFLIX.",
])
def test_fallback_keeps_other_movements(text):
    assert not is_cash_withdrawal(text)
    [movement] = fallback_extract_movement(text, "Fri, 20 Nov 2026 10:00:00 +0100")
    assert movement["es_retirada_efectivo"] is False
    assert movement["es_interno"] is False


def test_prompt_extracts_cash_withdrawals_instead_of_skipping_them():
    prompt, schema = ai_parser.load_prompt_configuration()
    assert "es_retirada_efectivo true" in prompt
    assert "cash withdrawals or ATM operations" not in prompt
    assert "ATM withdrawals are not transactions" not in prompt
    item = schema["items"]
    assert item["properties"]["es_retirada_efectivo"] == {"type": "boolean"}
    assert "es_retirada_efectivo" in item["required"]
    assert "es_retirada_efectivo" in item["propertyOrdering"]


def test_built_in_prompt_and_schema_match_the_editable_files():
    from pathlib import Path
    import json

    prompts = Path(ai_parser.__file__).resolve().parent / "prompts"
    assert ai_parser.SYSTEM_INSTRUCTION == (prompts / "system_instruction.txt").read_text(encoding="utf-8").strip()
    file_schema = json.loads((prompts / "response_schema.json").read_text(encoding="utf-8"))
    for key in ("required", "propertyOrdering"):
        assert ai_parser.TRANSACTION_SCHEMA["items"][key] == file_schema["items"][key]
