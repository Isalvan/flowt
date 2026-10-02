from category_suggestions import category_fields
from ai_parser import load_prompt_configuration


def test_valid_suggestion_is_separate_from_confirmed_category():
    assert category_fields({"tipo": "gasto", "categoria_sugerida": "ocio", "categoria_confianza": "media"}) == {
        "categoria_sugerida": "ocio", "categoria_confianza": "media"
    }


def test_bad_categories_do_not_discard_the_transaction():
    for category in ["nomina", "inventada", None, {"id": "ocio"}, "sin_categorizar"]:
        assert category_fields({"tipo": "gasto", "categoria_sugerida": category}) == {}
    assert category_fields({"tipo": "ingreso", "categoria_sugerida": "otros_ingresos", "categoria_confianza": "inventada"})["categoria_confianza"] == "baja"


def test_prompt_and_schema_request_reviewable_categories_and_supported_bizum():
    prompt, schema = load_prompt_configuration()
    assert "categoria_sugerida" in schema["items"]["properties"]
    assert "categoria_sugerida" not in schema["items"]["required"]
    assert "independent from transaction confidence" in prompt
    assert "never confirmed decisions" in prompt
    assert "explicit spending purpose" in prompt
    assert "Outgoing Bizum and ATM withdrawals are not transactions" not in prompt
