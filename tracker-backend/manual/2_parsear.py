import os
import json
import sys
import re

# Añadir el directorio padre al path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Importar la lógica de fallback de main o fallback_logic (si existe)
try:
    from fallback_logic import fallback_extract_movement
except ImportError:
    # Si no se puede importar, definimos una básica aquí
    def fallback_extract_movement(body, email_date):
        return None

def main():
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    input_path = os.path.join(temp_dir, "correos_recuperados.json")
    output_path = os.path.join(temp_dir, "movimientos_a_subir.json")

    if not os.path.exists(input_path):
        print("ERROR: No se encuentra 'manual/temp/correos_recuperados.json'. Ejecuta primero 1_recuperar.py")
        return

    print(f"--- PASO 2: PARSEAR CORREOS ---")
    
    with open(input_path, "r", encoding="utf-8") as f:
        emails = json.load(f)

    movimientos_finales = []
    
    for email in emails:
        # Sanitizar subject para el print
        clean_subject = email['subject'].encode('ascii', 'ignore').decode('ascii')
        print(f"Procesando: {clean_subject[:40]}...")
        
        # Intentar extraer usando Regex (sin IA)
        data = fallback_extract_movement(email["body"], email["date_sent"])
        
        if data:
            for mov in data:
                mov["email_id"] = email["id"]
                movimientos_finales.append(mov)
        else:
            # Si falla el regex, dejamos una plantilla para que el usuario rellene
            movimientos_finales.append({
                "email_id": email["id"],
                "tipo": "gasto", # o ingreso
                "importe": 0.0,
                "moneda": "EUR",
                "fecha": email["date_sent"],
                "descripcion": f"RELLENAR: {email['subject']}",
                "confianza": "manual_review"
            })

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(movimientos_finales, f, indent=4, ensure_ascii=False)

    print(f"\nOK: Se han generado {len(movimientos_finales)} movimientos en 'manual/temp/movimientos_a_subir.json'")
    print("REVISA ESE ARCHIVO. Puedes modificar los importes, descripciones o tipos antes de enviarlos.")

if __name__ == "__main__":
    main()
