import os
import json
import re

from dotenv import load_dotenv
from google import genai
from google.genai import types
from bs4 import BeautifulSoup

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
if API_KEY:
    client = genai.Client(api_key=API_KEY)
else:
    client = None


def sanitize_body_for_ai(body: str) -> str:
    """
    Minimiza y redacta datos personales sensibles (IBANs, tarjetas de crédito, DNI/NIE)
    antes de enviar el texto a Gemini AI para proteger la privacidad.
    """
    if not body:
        return ""

    sanitized = body

    # 1. Redactar IBAN / Cuentas Bancarias
    sanitized = re.sub(r'\bES\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{2}[\s-]?\d{10}\b', '[CUENTA_REDACTADA]', sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r'\b[A-Z]{2}\d{2}[\s-]?(?:\d[\s-]?){10,26}\d\b', '[CUENTA_REDACTADA]', sanitized, flags=re.IGNORECASE)

    # 2. Redactar Tarjetas de Crédito/Débito (completas o enmascaradas p.ej. **** 4321 o 4500-1234-5678-9012)
    sanitized = re.sub(r'\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b', '[TARJETA_REDACTADA]', sanitized)
    sanitized = re.sub(r'(?:\*{2,16}[\s-]*\d{4}|\b\d{4}[\s-]*\*{2,16})', '[TARJETA_REDACTADA]', sanitized)

    # 3. Redactar DNI / NIE / NIF
    sanitized = re.sub(r'\b(?:[0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])\b', '[ID_REDACTADO]', sanitized, flags=re.IGNORECASE)

    # 4. Limitar longitud máxima a 2000 caracteres
    return sanitized[:2000].strip()


def clean_body(html_body):
    """
    Limpia el HTML masivo de Unicaja y extrae solo el bloque central de texto.
    Reduce 500KB a unos pocos bytes.
    """
    if not html_body:
        return ""

    soup = BeautifulSoup(html_body, "html.parser")
    for script_or_style in soup(["script", "style"]):
        script_or_style.decompose()

    text = soup.get_text(separator=" ", strip=True)

    pattern = re.compile(r"Hola,.*?:(.*?)(?=Atentamente|Atentamente,|$)", re.DOTALL | re.IGNORECASE)
    match = pattern.search(text)

    if match:
        extracted = match.group(1).strip()
    else:
        extracted = text

    return sanitize_body_for_ai(extracted)


def extract_with_gemini(text, email_date):
    """
    Llama a Gemini usando el SDK oficial y esquema JSON con texto sanitizado.
    """
    if not API_KEY or not client:
        return None

    sanitized_text = sanitize_body_for_ai(text)

    model_name = os.getenv("AI_MODEL", "gemini-1.5-flash")
    if model_name.startswith("models/"):
        model_name = model_name[7:]

    prompt = f"""
    INSTRUCCIONES:
    Extrae los movimientos bancarios del siguiente texto de un correo de notificación.
    Fecha del correo: {email_date}

    ### REGLA DE ORO DE FILTRADO ###
    SI EL TEXTO MENCIONA UNA "RECARGA" (Top-up) DE TARJETA O SALDO:
    - DEBES DEVOLVER UNA LISTA VACÍA: []
    - NO EXTRAIGAS NADA.

    ### QUÉ EXTRAER ###
    - Solo cargos reales en comercios (compras, suscripciones, pagos).
    - Ingresos de dinero reales.

    DATOS A ANALIZAR (NO CONFIABLES Y SANITIZADOS):
    ---
    {sanitized_text}
    ---

    Devuelve SIEMPRE un JSON con esta estructura (una lista de objetos):
    [{{
        "tipo": "gasto" | "ingreso",
        "importe": float,
        "moneda": "EUR",
        "fecha": "ISO8601 string",
        "descripcion": "descripción corta",
        "confianza": "alta" | "media" | "baja"
    }}]
    """

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"Error llamando a Gemini: {e}")
        return None
