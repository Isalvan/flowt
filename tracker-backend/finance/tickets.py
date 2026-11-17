"""Ticket extraction and pure validation of untrusted model output."""
import base64
import json
import math
import os
import re
from datetime import date
from pathlib import Path
from threading import Lock
from time import monotonic

from reviews.domain import ReviewError

PROMPTS = Path(__file__).resolve().parents[1] / "prompts"
CATEGORIES = json.loads((PROMPTS / "categories.json").read_text(encoding="utf-8"))
EXPENSES = {c["id"] for c in CATEGORIES if c["tipo"] in ("gasto", "ambos")}
TICKET_PROMPT = (PROMPTS / "ticket.md").read_text(encoding="utf-8").strip()
TICKET_SCHEMA = json.loads((PROMPTS / "ticket_schema.json").read_text(encoding="utf-8"))
MAX_TICKET_BODY = 2 * 1024 * 1024
NOT_A_TICKET = "No he podido leer el ticket. Prueba con más luz y el ticket entero."
INVALID_IMAGE = "Envía una imagen base64 sin prefijo y un mime image/jpeg, image/png o image/webp."


def not_a_ticket():
    raise ReviewError("not_a_ticket", NOT_A_TICKET)


def label(value):
    return value.strip()[:120] if isinstance(value, str) else ""


def number(value):
    if isinstance(value, str) and re.fullmatch(r"-?[0-9]+(?:[.,][0-9]+)?", value.strip()):
        try:
            value = float(value.strip().replace(",", "."))
        except ValueError:
            not_a_ticket()
    if isinstance(value, bool) or not isinstance(value, (int, float)) or abs(value) > 1_000_000 or not math.isfinite(value):
        not_a_ticket()
    return value


def cents(value):
    # Half away from zero, shared with the Worker, including discount lines.
    return (1 if value >= 0 else -1) * math.floor(abs(value) * 100 + 0.5 + 1e-8)


def sanitize_ticket(raw, today):
    """Return the contract or not_a_ticket; the caller supplies today's ISO date."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, RecursionError):
            not_a_ticket()
    if (not isinstance(raw, dict) or raw.get("es_ticket") is False or not label(raw.get("comercio"))
            or not isinstance(raw.get("lineas"), list) or not 1 <= len(raw["lineas"]) <= 150):
        not_a_ticket()
    amount = number(raw.get("total"))
    total = cents(amount)
    if amount <= 0 or amount > 10000 or total <= 0:
        not_a_ticket()
    lineas = []
    for line in raw["lineas"]:
        if not isinstance(line, dict) or not label(line.get("descripcion")):
            not_a_ticket()
        cantidad = number(1 if line.get("cantidad") is None else line["cantidad"])
        if cantidad <= 0:
            not_a_ticket()
        lineas.append({"descripcion": label(line["descripcion"]), "cantidad": cantidad, "importe": cents(number(line.get("importe"))) / 100})
    fecha = None
    if isinstance(raw.get("fecha"), str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", raw["fecha"]):
        try:
            parsed = date.fromisoformat(raw["fecha"]).isoformat()
            if parsed <= today:
                fecha = parsed
        except ValueError:
            pass
    moneda = raw.get("moneda")
    moneda = moneda.strip().upper() if isinstance(moneda, str) else ""
    if not re.fullmatch(r"[A-Z]{3}", moneda):
        not_a_ticket()
    difference = total - sum(cents(line["importe"]) for line in lineas)
    category = raw.get("categoria_sugerida")
    return {"comercio": label(raw["comercio"]), "fecha": fecha, "total": total / 100, "moneda": moneda,
            "categoria_sugerida": category if isinstance(category, str) and category in EXPENSES else "sin_categorizar",
            "lineas": lineas, "cuadra": abs(difference) <= 5, "diferencia": difference / 100}


def validate_ticket_image(body):
    image = body.get("image") if isinstance(body, dict) else None
    if (not isinstance(body, dict) or body.get("mime") not in ("image/jpeg", "image/png", "image/webp")
            or not isinstance(image, str) or not image or len(image) % 4
            or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", image)):
        raise ReviewError("invalid_arguments", INVALID_IMAGE)
    return {"image": image, "mime": body["mime"]}


def scan_ticket(body, today, client=None):
    """The injected google-genai client keeps tests offline. Never log provider errors."""
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise ReviewError("not_configured", "El escaneo de tickets no está configurado")
    from google import genai
    from google.genai import types

    owned_client = client is None
    if owned_client:
        client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=45_000))
    try:
        catalog = ", ".join(c["id"] for c in CATEGORIES if c["tipo"] in ("gasto", "ambos"))
        response = client.models.generate_content(
            model=os.getenv("TICKET_AI_MODEL") or "gemini-3.5-flash",
            contents=[TICKET_PROMPT + "\nCatálogo de gastos: " + catalog + ".",
                      types.Part.from_bytes(data=base64.b64decode(body["image"], validate=True), mime_type=body["mime"])],
            config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=TICKET_SCHEMA, temperature=0),
        )
        candidates = response.candidates
        if not candidates or (candidates[0].finish_reason and candidates[0].finish_reason != "STOP"):
            not_a_ticket()
        parts = candidates[0].content.parts if candidates[0].content else []
        raw = "".join(part.text for part in (parts or []) if not part.thought and isinstance(part.text, str))
        return sanitize_ticket(raw, today)
    finally:
        if owned_client:
            client.close()


class TicketRateLimiter:
    """Per-process fixed window, matching the Worker's best-effort isolate limit."""
    def __init__(self, now=monotonic):
        self.now = now
        self.windows = {}
        self.lock = Lock()

    def check(self, uid):
        with self.lock:
            now = self.now()
            count, reset = self.windows.get(uid, (0, now + 60))
            if now >= reset:
                count, reset = 0, now + 60
            self.windows[uid] = (count + 1, reset)
            if len(self.windows) > 10000:
                self.windows = {key: value for key, value in self.windows.items() if value[1] > now}
                while len(self.windows) > 10000:
                    del self.windows[next(iter(self.windows))]
            return count < 10, max(1, math.ceil(reset - now))
