import os
import json
import sys
import re
from dotenv import load_dotenv
from google import genai
from google.genai import types
from bs4 import BeautifulSoup

# Añadir el directorio padre al path para importar lógica común
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Cargar variables de entorno
load_dotenv()

# Configurar Gemini
API_KEY = os.getenv("GEMINI_API_KEY")
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
    
    # 1. Usar BeautifulSoup para extraer texto limpio
    soup = BeautifulSoup(html_body, "html.parser")
    # Eliminar scripts y estilos
    for script_or_style in soup(["script", "style"]):
        script_or_style.decompose()
        
    text = soup.get_text(separator=" ", strip=True)
    
    # 2. Localizar el patrón de Unicaja: "Hola, [Nombre]:" ... "Atentamente,"
    # Esto elimina avisos legales y basura de la App Store
    pattern = re.compile(r"Hola,.*?:(.*?)(?=Atentamente|Atentamente,|$)", re.DOTALL | re.IGNORECASE)
    match = pattern.search(text)
    
    if match:
        clean_text = match.group(1).strip()
        return clean_text
    
    # Si no encuentra el patrón, devolvemos el texto recortado (primeros 2000 chars)
    return text[:2000]

def extract_with_gemini(text, email_date):
    """
    Llama a Gemini 1.5 Flash usando el SDK oficial y esquema JSON.
    """
    if not API_KEY or not client:
        print("AVISO: GEMINI_API_KEY no configurada. Usando fallback.")
        return None

    # Usar el modelo del .env o uno por defecto
    model_name = os.getenv("AI_MODEL", "gemini-1.5-flash")
    if model_name.startswith("models/"):
        model_name = model_name[7:]
    
    prompt = f"""
    Extrae los movimientos bancarios del siguiente texto de un correo de notificación.
    Fecha del correo: {email_date}
    
    ### REGLA DE ORO DE FILTRADO ###
    SI EL TEXTO MENCIONA UNA "RECARGA" (Top-up) DE TARJETA O SALDO:
    - DEBES DEVOLVER UNA LISTA VACÍA: []
    - NO EXTRAIGAS NADA.
    
    ### QUÉ EXTRAER ###
    - Solo cargos reales en comercios (compras, suscripciones, pagos).
    - Ingresos de dinero reales.
    
    Texto:
    {text}
    
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
        # Usar generation_config para forzar JSON
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

def main():
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    input_path = os.path.join(temp_dir, "correos_recuperados.json")
    output_path = os.path.join(temp_dir, "movimientos_a_subir.json")

    if not os.path.exists(input_path):
        print("ERROR: No se encuentra 'manual/temp/correos_recuperados.json'. Ejecuta primero 1_recuperar.py")
        return

    print(f"--- PASO 2: PARSEAR CORREOS (Limpieza + IA) ---")
    
    with open(input_path, "r", encoding="utf-8") as f:
        emails = json.load(f)

    movimientos_finales = []
    textos_para_revision = []
    
    for email in emails:
        clean_subject = email['subject'].encode('ascii', 'ignore').decode('ascii')
        print(f"\n>>> Procesando: {clean_subject[:40]}...")
        
        # 1. Limpiar el cuerpo del correo
        body_clean = clean_body(email["body"])
        
        # Guardar para revisión
        textos_para_revision.append(f"--- CORREO: {clean_subject} ---\n{body_clean}\n{'-'*40}\n")
        
        print("TEXTO LIMPIO QUE SE ENVÍA A LA IA:")
        print(f"[{body_clean}]")
        
        # 2. Intentar extraer con IA (Gemini SDK)
        data = extract_with_gemini(body_clean, email["date_sent"])
        
        if data is not None:
            if len(data) > 0:
                for mov in data:
                    mov["email_id"] = email["id"]
                    movimientos_finales.append(mov)
                    print(f"  [IA] detectado: {mov['importe']} {mov['moneda']} - {mov['descripcion']}")
            else:
                print("  [INFO] Movimiento ignorado por la IA (Recarga o ruido).")
        else:
            print("  [FALLBACK] Error en la API. Creando entrada manual.")
            movimientos_finales.append({
                "email_id": email["id"],
                "tipo": "gasto",
                "importe": 0.0,
                "moneda": "EUR",
                "fecha": email["date_sent"],
                "descripcion": f"RELLENAR: {email['subject']}",
                "confianza": "manual_review"
            })

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(movimientos_finales, f, indent=4, ensure_ascii=False)

    # Guardar los textos limpios para que el usuario pueda verlos
    debug_path = os.path.join(temp_dir, "revision_limpieza.txt")
    with open(debug_path, "w", encoding="utf-8") as f:
        f.writelines(textos_para_revision)

    print(f"\nOK: Se han generado {len(movimientos_finales)} movimientos en 'manual/temp/movimientos_a_subir.json'")
    print(f"DEBUG: Tienes los textos limpios en 'manual/temp/revision_limpieza.txt' para revisar.")
    print("REVISA EL ARCHIVO antes de ejecutar 3_enviar.py")

if __name__ == "__main__":
    main()

