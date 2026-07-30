import pytest
from ai_parser import sanitize_body_for_ai


def test_sanitize_iban_redaction():
    text = "Cargo de 50.0 EUR en cuenta ES91 2100 0418 45 0200051332 realizacion de compra."
    sanitized = sanitize_body_for_ai(text)
    assert "[CUENTA_REDACTADA]" in sanitized
    assert "ES91 2100 0418 45 0200051332" not in sanitized


def test_sanitize_credit_card_redaction():
    text = "Pago con tarjeta **** 4321 en comercio Amazon 29.99 EUR."
    sanitized = sanitize_body_for_ai(text)
    assert "[TARJETA_REDACTADA]" in sanitized
    assert "**** 4321" not in sanitized

    text2 = "Pago con tarjeta 4500-1234-5678-9012 en Mercadona."
    sanitized2 = sanitize_body_for_ai(text2)
    assert "[TARJETA_REDACTADA]" in sanitized2
    assert "4500-1234-5678-9012" not in sanitized2


def test_sanitize_dni_redaction():
    text = "Titular DNI 12345678Z operacion 100 EUR."
    sanitized = sanitize_body_for_ai(text)
    assert "[ID_REDACTADO]" in sanitized
    assert "12345678Z" not in sanitized


def test_sanitize_truncation():
    text = "A" * 3000
    sanitized = sanitize_body_for_ai(text)
    assert len(sanitized) == 2000
