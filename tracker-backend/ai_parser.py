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
        return match.group(1).strip()

    return text[:2000]


def extract_with_gemini(text, email_date):
    """
    Llama a Gemini 1.5 Flash usando el SDK oficial y esquema JSON.
    """
    if not API_KEY or not client:
        return None

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

    DATOS A ANALIZAR (NO CONFIABLES):
    ---
    {text}
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
