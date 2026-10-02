"""Catálogo compartido con la web y validación aislada de las propuestas de IA."""
import json
from pathlib import Path

CATEGORIES = json.loads((Path(__file__).parent / "prompts" / "categories.json").read_text(encoding="utf-8"))


def category_fields(parsed):
    """Una categoría inválida no descarta un movimiento financiero válido."""
    category = parsed.get("categoria_sugerida")
    valid = any(c["id"] == category and c["tipo"] in (parsed.get("tipo"), "ambos") for c in CATEGORIES)
    if not valid or category == "sin_categorizar":
        return {}
    confidence = parsed.get("categoria_confianza", "baja")
    if confidence not in ("alta", "media", "baja"):
        confidence = "baja"
    return {"categoria_sugerida": category, "categoria_confianza": confidence}


def category_instruction():
    expenses = ", ".join(f'{c["id"]} ({c["label"]})' for c in CATEGORIES if c["tipo"] == "gasto")
    incomes = ", ".join(f'{c["id"]} ({c["label"]})' for c in CATEGORIES if c["tipo"] == "ingreso")
    return f"""
CATEGORY SUGGESTIONS (independent from transaction confidence):
For each extracted transaction return categoria_sugerida and categoria_confianza.
Expense categories: {expenses}.
Income categories: {incomes}.
Choose only a category matching the transaction direction. These are suggestions for user review, never confirmed decisions.
alta: explicit recognizable merchant or explicit purpose. media: plausible purpose with limited detail. baja: unclear purpose.
If only a person's name or a generic transfer/Bizum is present, use otros_ingresos or otros_gastos and baja. Never infer a gift, sale, salary or reimbursement from a person's name or amount alone.
Generic Google/PayPal descriptors do not identify the purchased service: use a broad plausible category and baja. A bank name is not a merchant.
For a Bizum with an explicit spending concept (cinema, food, Spotify, purchases), suggest the corresponding expense category. "Comida" alone is ambiguous between groceries and restaurants: use baja.
Do not change the extracted description to match a category. Never invent a purpose or a compensation link.
""".strip()
