import os
import hashlib
import logging
import argparse
import re
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore


import functions_framework
from gmail_client import get_unread_emails_from_bank, mark_email_as_read
from fallback_logic import fallback_extract_movement
from ai_parser import clean_body, extract_with_gemini

# --- Configuration & Initialization ---

def parse_args():
    parser = argparse.ArgumentParser(description="Bank Movement Tracker Backend")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    return parser.parse_args()

# Global config variables (will be initialized in setup_config)
BANK_SENDER = None
UID_PROPIETARIO = None
MAX_EMAILS_PER_RUN = None
AI_MODEL = None
PROMPT_VERSION = "v1"
args = None
logger = logging.getLogger(__name__)

def setup_config(cli_args=None):
    global BANK_SENDER, UID_PROPIETARIO, MAX_EMAILS_PER_RUN, AI_MODEL, args, logger
    
    args = cli_args or argparse.Namespace(verbose=False)
    
    # Load environment variables
    load_dotenv()

    BANK_SENDER = os.getenv("BANK_SENDER")
    UID_PROPIETARIO = os.getenv("UID_PROPIETARIO")
    MAX_EMAILS_PER_RUN = int(os.getenv("MAX_EMAILS_PER_RUN", "10"))
    AI_MODEL = os.getenv("AI_MODEL", "gemini-3-flash-preview")

    # Setup Logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    
    # Clear existing handlers to avoid duplicates during setup_config calls
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
        
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler("tracker.log"),
            logging.StreamHandler()
        ]
    )
    # Re-get logger after basicConfig
    logger = logging.getLogger(__name__)

    if args.verbose:
        logger.debug("Verbose logging enabled.")

    # Initialize Firebase
    global db
    if not firebase_admin._apps:
        try:
            cred_path = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
            if os.path.exists(cred_path):
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
            else:
                firebase_admin.initialize_app()
            logger.info("Firebase initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize Firebase: {e}")
            # In tests we might not want to exit(1)
            if __name__ == "__main__":
                exit(1)
    
    db = firestore.client()
    return db

# Default DB instance for module-level access if needed (but prefer setup_config)
db = None

# --- Helpers ---




def validate_parsed_data(data: Dict[str, Any]) -> bool:
    """
    Validates the JSON returned by Gemini.
    """
    if not data:
        return False
    
    required_fields = ["tipo", "importe", "fecha"]
    if not all(field in data for field in required_fields):
        return False
    
    if data["tipo"] not in ["gasto", "ingreso"]:
        return False
    
    try:
        importe = float(data["importe"])
        if not (0 < importe < 100000):
            return False
    except (ValueError, TypeError):
        return False
    
    return True

@firestore.transactional
def process_movement_transaction(transaction, mov_ref, movimiento: Dict[str, Any], owner_id: str):
    """
    Firestore transaction to save the movement and update huchas.
    Returns True if a new movement was created, False if it already existed.
    """
    # Check if movement already exists
    mov_snapshot = mov_ref.get(transaction=transaction)
    if mov_snapshot.exists:
        return False

    # Read stats doc before any writes
    stats_ref = db.collection("stats").document(owner_id)
    stats_snapshot = stats_ref.get(transaction=transaction)

    huchas_ref = db.collection("huchas")
    query = huchas_ref.where("id_propietario", "==", owner_id).order_by("orden")
    # ... rest of the logic remains the same ...
    
    # Get all huchas for the owner - ALL READS MUST HAPPEN FIRST
    huchas_docs = list(query.stream(transaction=transaction))
    amount = float(movimiento["importe"])
    distributions = {} # doc_id -> amount_change (positive or negative)
    
    target_gasto_hucha_id = None
    new_hucha_ref = None
    new_hucha_data = None

    if not huchas_docs:
        logger.info(f"No huchas found for user {owner_id}. Creating default 'Cuenta Principal'.")
        new_hucha_ref = huchas_ref.document()
        target_gasto_hucha_id = new_hucha_ref.id
        
        if movimiento["tipo"] == "ingreso":
            distributions[target_gasto_hucha_id] = amount
        else:
            distributions[target_gasto_hucha_id] = -amount
            
        new_hucha_data = {
            "id_propietario": owner_id,
            "nombre": "Cuenta Principal",
            "tipo_aportacion": "resto",
            "saldo_acumulado": distributions[target_gasto_hucha_id],
            "orden": 1,
            "es_principal": True,
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        }
    else:
        if movimiento["tipo"] == "ingreso":
            total_percentage = sum(
                doc.to_dict().get("valor_aportacion", 0) 
                for doc in huchas_docs 
                if doc.to_dict().get("tipo_aportacion") == "porcentaje"
            )
            if total_percentage > 100:
                logger.error(f"Total percentage ({total_percentage}%) exceeds 100%. Income not distributed.")
            else:
                remaining_amount = amount
                # 1. Flat amounts
                for doc in huchas_docs:
                    data = doc.to_dict()
                    if data.get("tipo_aportacion") == "flat":
                        flat_val = float(data.get("valor_aportacion", 0))
                        to_add = min(flat_val, remaining_amount)
                        distributions[doc.id] = to_add
                        remaining_amount -= to_add

                # 2. Percentages
                for doc in huchas_docs:
                    data = doc.to_dict()
                    if data.get("tipo_aportacion") == "porcentaje":
                        perc_val = float(data.get("valor_aportacion", 0))
                        to_add = amount * (perc_val / 100.0)
                        to_add = min(to_add, remaining_amount)
                        distributions[doc.id] = distributions.get(doc.id, 0) + to_add
                        remaining_amount -= to_add

                # 3. Resto (Income Overflow)
                # We strictly look for the hucha defined as "resto"
                resto_hucha = next((doc for doc in huchas_docs if doc.to_dict().get("tipo_aportacion") == "resto"), None)
                
                # Fallback: If no "resto" hucha exists, use the one marked as principal
                if not resto_hucha:
                    resto_hucha = next((doc for doc in huchas_docs if doc.to_dict().get("es_principal")), None)
                
                # Final Fallback: First available hucha (to ensure money is always stored)
                if not resto_hucha and huchas_docs:
                    resto_hucha = huchas_docs[0]
                
                if resto_hucha and remaining_amount > 0:
                    distributions[resto_hucha.id] = distributions.get(resto_hucha.id, 0) + remaining_amount
        else:
            # Es gasto (Default Expense Pocket)
            # We strictly look for the hucha marked as "principal"
            target_hucha = next((doc for doc in huchas_docs if doc.to_dict().get("es_principal")), None)
            
            # Fallback: If no principal hucha exists, use the one defined as "resto"
            if not target_hucha:
                target_hucha = next((doc for doc in huchas_docs if doc.to_dict().get("tipo_aportacion") == "resto"), None)
            
            # Final Fallback: First available
            if not target_hucha and huchas_docs:
                target_hucha = huchas_docs[0]
                
            target_gasto_hucha_id = target_hucha.id
            distributions[target_gasto_hucha_id] = -amount

    # Apply updates - ALL WRITES MUST HAPPEN AFTER ALL READS
    for doc in huchas_docs:
        change = distributions.get(doc.id, 0)
        if change != 0:
            current_balance = doc.to_dict().get("saldo_acumulado", 0) or 0
            transaction.update(huchas_ref.document(doc.id), {
                "saldo_acumulado": current_balance + change,
                "updated_at": firestore.SERVER_TIMESTAMP
            })
            logger.info(f"Updated hucha {doc.id} balance by {change:.2f}")
            
    if new_hucha_ref and new_hucha_data:
        transaction.set(new_hucha_ref, new_hucha_data)
        logger.info(f"Created default hucha {new_hucha_ref.id} with balance {new_hucha_data['saldo_acumulado']:.2f}")

    if target_gasto_hucha_id:
        movimiento["hucha_id"] = target_gasto_hucha_id

    transaction.set(mov_ref, movimiento)

    # Update global stats atomically
    amount = float(movimiento["importe"])
    current_stats = stats_snapshot.to_dict() or {}
    if movimiento["tipo"] == "ingreso":
        new_total_ingresos = current_stats.get("total_ingresos", 0) + amount
        new_total_gastos = current_stats.get("total_gastos", 0)
    else:
        new_total_ingresos = current_stats.get("total_ingresos", 0)
        new_total_gastos = current_stats.get("total_gastos", 0) + amount
    transaction.set(stats_ref, {
        "total_ingresos": new_total_ingresos,
        "total_gastos": new_total_gastos,
        "updated_at": firestore.SERVER_TIMESTAMP,
    })

    return True

def extract_email(header_value: str) -> str:
    """Extracts the email address from a From header (e.g. 'Name <email@domain.com>' -> 'email@domain.com')"""
    match = re.search(r'<([^>]+)>', header_value)
    if match:
        return match.group(1).strip().lower()
    return header_value.strip().lower()

MIN_CONFIDENCE_THRESHOLD = os.getenv("MIN_CONFIDENCE", "baja").lower()

def get_confidence_score(level: str) -> int:
    return {"alta": 3, "media": 2, "baja": 1}.get(level.lower(), 0)

# In-memory cache for IDs that failed in this session to avoid blocking the queue
# They will be retried when the script restarts
FAILED_IDS_IN_SESSION = set()

# Se usa la función importada de fallback_logic.py


def process_emails():
    """
    Main processing loop.
    """
    emails = get_unread_emails_from_bank(BANK_SENDER, MAX_EMAILS_PER_RUN)
    
    for email in emails:
        email_id = email["id"]
        email_date = email["date_sent"]
        
        # Skip emails that failed in this session to avoid infinite loops until restart
        if email_id in FAILED_IDS_IN_SESSION:
            continue

        # 1. Limpiar HTML gigante (ahorra tokens)
        body_clean = clean_body(email["body"])
        logger.info(f"Procesando correo {email_id} con Gemini 1.5 Flash...")
        # 2. Llamar a la IA
        raw_movements = extract_with_gemini(body_clean, email_date)
        # 3. Fallback en caso de error de la IA
        if raw_movements is None:
            logger.warning(f"Fallo en Gemini para {email_id}. Intentando Fallback Regex...")
            raw_movements = fallback_extract_movement(email["body"], email_date)
        if not raw_movements:
            # Movimiento ignorado (ej: era una recarga)
            continue

        # Ensure we have a list of movements
        movements_list = raw_movements if isinstance(raw_movements, list) else [raw_movements]
        
        for index, parsed_data in enumerate(movements_list):
            if not validate_parsed_data(parsed_data):
                logger.warning(f"Movement {index} from email {email_id} discarded: Invalid data.")
                continue

            # Confidence Threshold Check
            ai_confidence = parsed_data.get("confianza", "baja").lower()
            if get_confidence_score(ai_confidence) < get_confidence_score(MIN_CONFIDENCE_THRESHOLD):
                logger.warning(f"Movement {index} from email {email_id} discarded: Confidence '{ai_confidence}' below threshold.")
                continue
                
            # Generate secure ID based on Gmail ID and movement index
            unique_id = f"{email_id}_{index}"
            doc_id = hashlib.sha256(unique_id.encode()).hexdigest()
            
            # Normalize date to datetime object for Firestore (ensures correct sorting)
            raw_fecha = parsed_data["fecha"]
            fecha_dt = None
            
            try:
                if isinstance(raw_fecha, str):
                    # Try ISO format first (Gemini default)
                    if 'T' in raw_fecha:
                        fecha_dt = datetime.fromisoformat(raw_fecha.replace('Z', '+00:00'))
                    elif '-' in raw_fecha:
                        # Handle YYYY-MM-DD
                        parts = raw_fecha.split('-')
                        if len(parts) == 3:
                            fecha_dt = datetime(int(parts[0]), int(parts[1]), int(parts[2]), tzinfo=timezone.utc)
                    elif '/' in raw_fecha:
                        # Handle DD/MM/YYYY from fallback or messy AI
                        parts = raw_fecha.split('/')
                        if len(parts) == 3:
                            # Assume DD/MM/YYYY or DD/MM/YY
                            day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
                            if year < 100: year += 2000
                            fecha_dt = datetime(year, month, day, tzinfo=timezone.utc)
                
                # If parsing failed or was email_date string
                if not fecha_dt:
                    # Try to parse as email header date
                    try:
                        fecha_dt = parsedate_to_datetime(email_date)
                    except:
                        fecha_dt = datetime.now(timezone.utc)
            except Exception as date_err:
                logger.warning(f"Date parsing failed for {raw_fecha}: {date_err}. Using email_date.")
                try:
                    fecha_dt = parsedate_to_datetime(email_date)
                except:
                    fecha_dt = datetime.now(timezone.utc)

            # Construct movement document
            movimiento = {
                "id_propietario": UID_PROPIETARIO,
                "tipo": parsed_data["tipo"],
                "concepto": parsed_data.get("descripcion") or parsed_data.get("concepto") or "Sin concepto",
                "importe": float(parsed_data["importe"]),
                "moneda": parsed_data.get("moneda", "EUR"),
                "fecha_operacion": fecha_dt, # Store as actual Timestamp in Firestore
                "confianza": parsed_data.get("confianza", "alta"),
                "version_prompt": PROMPT_VERSION,
                "created_at": firestore.SERVER_TIMESTAMP,
                "email_id": email_id
            }
            
            try:
                mov_ref = db.collection("movimientos").document(doc_id)
                transaction = db.transaction()
                # Capture the return value from the transaction
                was_recorded = process_movement_transaction(transaction, mov_ref, movimiento, UID_PROPIETARIO)
                
                if was_recorded:
                    logger.info(f"Movement {doc_id} (index {index}) recorded successfully.")
                else:
                    logger.info(f"Movement {doc_id} (index {index}) already exists. Skipping.")
                    
            except Exception as e:
                logger.error(f"Error saving movement {index} for email {email_id}: {e}")

        # Mark email as read only after processing all its movements
        if mark_email_as_read(email_id):
            logger.info(f"Email {email_id} marked as processed.")
        else:
            logger.error(f"Failed to mark email {email_id} as read.")

@functions_framework.http
def gmail_webhook(request):
    """
    Entrypoint para Google Cloud Functions.
    Se ejecuta cuando Pub/Sub detecta un correo nuevo o se llama a la URL directamente.
    """
    setup_config()

    if not BANK_SENDER or not UID_PROPIETARIO:
        return ("Faltan variables de entorno", 500)

    try:
        logger.info("Webhook recibido. Comprobando correos nuevos...")
        process_emails()
        return ("Correos procesados correctamente", 200)
    except Exception as e:
        logger.error(f"Error en el Webhook: {e}")
        return (f"Error: {e}", 500)

if __name__ == "__main__":
    setup_config(parse_args())
    if not BANK_SENDER or not UID_PROPIETARIO:
        logger.error("BANK_SENDER o UID_PROPIETARIO no configurados.")
        exit(1)
    
    logger.info("Ejecución manual/programada iniciada...")
    process_emails()
    logger.info("Ejecución finalizada.")
