import os
import json
import sys
from dotenv import load_dotenv

# Añadir el directorio padre al path para importar gmail_client
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gmail_client import get_unread_emails_from_bank

def main():
    # Cargar variables de entorno
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    
    bank_sender = os.getenv("BANK_SENDER")
    max_emails = int(os.getenv("MAX_EMAILS_PER_RUN", "20"))

    print(f"--- PASO 1: RECUPERAR CORREOS ---")
    print(f"Buscando correos de: {bank_sender}")
    
    try:
        emails = get_unread_emails_from_bank(bank_sender, max_results=max_emails)
        
        if not emails:
            print("No se encontraron correos nuevos sin leer.")
            return

        # Guardar los correos recuperados
        temp_dir = os.path.join(os.path.dirname(__file__), "temp")
        os.makedirs(temp_dir, exist_ok=True)
        output_path = os.path.join(temp_dir, "correos_recuperados.json")
        
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(emails, f, indent=4, ensure_ascii=False)
        
        print(f"OK: Se han guardado {len(emails)} correos en 'manual/temp/correos_recuperados.json'")
        print(f"Ahora puedes revisar ese archivo y decidir qué movimientos subir.")
        
    except Exception as e:
        print(f"ERROR al recuperar correos: {e}")

if __name__ == "__main__":
    main()
