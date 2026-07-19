# -*- coding: cp1252 -*-
import os
import hashlib
import hmac
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
def process_email_movements_transaction(transaction, movements_to_process: List[Dict], owner_id: str):
    """
    Firestore transaction to save MULTIPLE movements and update huchas.
    movements_to_process is a list of dicts: {"doc_id": "...", "movimiento": {...}}
    Returns the list of doc_ids that were actually recorded.
    """
    recorded_ids = []

    # 1. Read stats doc
    stats_ref = db.collection("stats").document(owner_id)
    stats_snapshot = stats_ref.get(transaction=transaction)

    # 2. Read all huchas
    huchas_ref = db.collection("huchas")
    query = huchas_ref.where("id_propietario", "==", owner_id).order_by("orden")
    huchas_docs = list(query.stream(transaction=transaction))
    
    # 3. Read active subscriptions
    subs_ref = db.collection("suscripciones")
    subs_query = subs_ref.where("id_propietario", "==", owner_id).where("activa", "==", True)
    subs_docs = list(subs_query.stream(transaction=transaction))
    
    # 4. Check which movements exist
    mov_refs = [db.collection("movimientos").document(m["doc_id"]) for m in movements_to_process]
    if not mov_refs:
        return []
    mov_snapshots = db.get_all(mov_refs, transaction=transaction)
    existing_ids = {snap.id for snap in mov_snapshots if snap.exists}

    # Group active subscriptions by linked hucha
    freq_divisors = {"mensual": 1, "trimestral": 3, "semestral": 6, "anual": 12}
    linked_provisions = {} # hucha_id -> total_mensual
    subs_hucha_id = None
    
    # We will accumulate the state of huchas in memory
    # Initialize with current DB state
    huchas_state = {}
    for h_doc in huchas_docs:
        data = h_doc.to_dict()
        huchas_state[h_doc.id] = {
            "ref": h_doc.reference,
            "data": data,
            "saldo_actual": float(data.get("saldo_acumulado", 0) or 0),
            "deuda_actual": float(data.get("deuda_pendiente", 0) or 0)
        }
        if data.get("es_suscripciones"):
            subs_hucha_id = h_doc.id

    for s_doc in subs_docs:
        s_data = s_doc.to_dict()
        divisor = freq_divisors.get(s_data.get("frecuencia", "mensual"), 1)
        mi_parte = s_data.get("mi_parte")
        importe_efectivo = float(mi_parte) if mi_parte is not None else float(s_data.get("importe", 0))
        mensual = importe_efectivo / divisor
        h_id = s_data.get("hucha_id")
        if h_id:
            linked_provisions[h_id] = linked_provisions.get(h_id, 0) + mensual

    stats_changes = {"ingresos": 0.0, "gastos": 0.0}
    
    new_hucha_ref = None
    new_hucha_data = None
    
    for m in movements_to_process:
        doc_id = m["doc_id"]
        if doc_id in existing_ids:
            continue
            
        movimiento = m["movimiento"]
        amount = float(movimiento["importe"])
        target_gasto_hucha_id = None
        
        # If no huchas exist, create default
        if not huchas_state and not new_hucha_ref:
            logger.info(f"No huchas found for user {owner_id}. Creating default 'Cuenta Principal'.")
            new_hucha_ref = huchas_ref.document()
            target_gasto_hucha_id = new_hucha_ref.id
            
            init_balance = amount if movimiento["tipo"] == "ingreso" else -amount
            
            new_hucha_data = {
                "id_propietario": owner_id,
                "nombre": "Cuenta Principal",
                "tipo_aportacion": "resto",
                "saldo_acumulado": init_balance,
                "orden": 1,
                "es_principal": True,
                "created_at": firestore.SERVER_TIMESTAMP,
                "updated_at": firestore.SERVER_TIMESTAMP
            }
            # Put it in huchas_state so next movement in same batch sees it
            huchas_state[target_gasto_hucha_id] = {
                "ref": new_hucha_ref,
                "data": new_hucha_data,
                "saldo_actual": init_balance
            }
            
            movimiento["hucha_id"] = target_gasto_hucha_id
            transaction.set(mov_refs[movements_to_process.index(m)], movimiento)
            recorded_ids.append(doc_id)
            if not movimiento.get("es_interno", False):
                if movimiento["tipo"] == "ingreso":
                    stats_changes["ingresos"] += amount
                else:
                    stats_changes["gastos"] += amount
            continue

        if movimiento["tipo"] == "ingreso":
            total_percentage = sum(
                h_info["data"].get("valor_aportacion", 0) 
                for h_info in huchas_state.values() 
                if h_info["data"].get("tipo_aportacion") == "porcentaje"
            )
            if total_percentage > 100:
                logger.error(f"Total percentage ({total_percentage}%) exceeds 100%. Income not distributed.")
            else:
                remaining_amount = amount
                # 1. Flat amounts
                for h_id, h_info in huchas_state.items():
                    data = h_info["data"]
                    if data.get("tipo_aportacion") == "flat":
                        planned_total = float(data.get("valor_aportacion", 0))
                        
                        # Apply tope_objetivo if exists
                        if data.get("tope_objetivo") and data.get("objetivo"):
                            objetivo = float(data.get("objetivo"))
                            if objetivo > 0:
                                current_balance = h_info["saldo_actual"]
                                hueco_libre = max(0, objetivo - current_balance)
                                planned_total = min(planned_total, hueco_libre)
                        
                        # Apply provisions subtraction logic
                        if h_id == subs_hucha_id:
                            provision_from_others = sum(linked_provisions.values())
                            effective_target = max(0, planned_total - provision_from_others)
                        else:
                            provision_for_subs = linked_provisions.get(h_id, 0)
                            effective_target = max(0, planned_total - provision_for_subs)
                            
                            # Add provision to Subs hucha instead of this hucha
                            if provision_for_subs > 0 and subs_hucha_id and remaining_amount > 0:
                                to_subs = min(provision_for_subs, remaining_amount)
                                huchas_state[subs_hucha_id]["saldo_actual"] += to_subs
                                remaining_amount -= to_subs
                        
                        to_add = min(effective_target, remaining_amount)
                        if to_add > 0:
                            remaining_amount -= to_add
                            
                            # Intercept for debt repayment
                            if h_info["deuda_actual"] > 0:
                                lender_id = data.get("deuda_con")
                                payment = min(h_info["deuda_actual"], to_add)
                                h_info["deuda_actual"] -= payment
                                to_add -= payment
                                if lender_id and lender_id in huchas_state:
                                    huchas_state[lender_id]["saldo_actual"] += payment
                                    logger.info(f"Intercepted {payment} from flat allocation to {h_id} to repay debt to {lender_id}")

                            huchas_state[h_id]["saldo_actual"] += to_add

                # 2. Percentages
                for h_id, h_info in huchas_state.items():
                    data = h_info["data"]
                    if data.get("tipo_aportacion") == "porcentaje":
                        perc_val = float(data.get("valor_aportacion", 0))
                        planned_total = amount * (perc_val / 100.0)
                        
                        # Apply tope_objetivo if exists
                        if data.get("tope_objetivo") and data.get("objetivo"):
                            objetivo = float(data.get("objetivo"))
                            if objetivo > 0:
                                current_balance = h_info["saldo_actual"]
                                hueco_libre = max(0, objetivo - current_balance)
                                planned_total = min(planned_total, hueco_libre)
                        
                        provision_for_subs = linked_provisions.get(h_id, 0)
                        effective_target = max(0, planned_total - provision_for_subs)
                        
                        # Add provision to Subs hucha
                        if provision_for_subs > 0 and subs_hucha_id and remaining_amount > 0:
                            to_subs = min(provision_for_subs, remaining_amount)
                            huchas_state[subs_hucha_id]["saldo_actual"] += to_subs
                            remaining_amount -= to_subs

                        to_add = min(effective_target, remaining_amount)
                        if to_add > 0:
                            remaining_amount -= to_add
                            
                            # Intercept for debt repayment
                            if h_info["deuda_actual"] > 0:
                                lender_id = data.get("deuda_con")
                                payment = min(h_info["deuda_actual"], to_add)
                                h_info["deuda_actual"] -= payment
                                to_add -= payment
                                if lender_id and lender_id in huchas_state:
                                    huchas_state[lender_id]["saldo_actual"] += payment
                                    logger.info(f"Intercepted {payment} from % allocation to {h_id} to repay debt to {lender_id}")

                            huchas_state[h_id]["saldo_actual"] += to_add

                # 3. Resto (Income Overflow)
                resto_hucha_id = next((h_id for h_id, h_info in huchas_state.items() if h_info["data"].get("tipo_aportacion") == "resto"), None)
                if not resto_hucha_id:
                    resto_hucha_id = next((h_id for h_id, h_info in huchas_state.items() if h_info["data"].get("es_principal")), None)
                if not resto_hucha_id and huchas_state:
                    resto_hucha_id = list(huchas_state.keys())[0]
                
                if resto_hucha_id and remaining_amount > 0:
                    resto_info = huchas_state[resto_hucha_id]
                    to_add = remaining_amount
                    remaining_amount = 0
                    
                    if resto_info["deuda_actual"] > 0:
                        lender_id = resto_info["data"].get("deuda_con")
                        payment = min(resto_info["deuda_actual"], to_add)
                        resto_info["deuda_actual"] -= payment
                        to_add -= payment
                        if lender_id and lender_id in huchas_state:
                            huchas_state[lender_id]["saldo_actual"] += payment
                            logger.info(f"Intercepted {payment} from resto allocation to {resto_hucha_id} to repay debt to {lender_id}")
                    
                    resto_info["saldo_actual"] += to_add
        else:
            # Es gasto
            target_hucha_id = next((h_id for h_id, h_info in huchas_state.items() if h_info["data"].get("es_principal")), None)
            if not target_hucha_id:
                target_hucha_id = next((h_id for h_id, h_info in huchas_state.items() if h_info["data"].get("tipo_aportacion") == "resto"), None)
            if not target_hucha_id and huchas_state:
                target_hucha_id = list(huchas_state.keys())[0]
                
            target_gasto_hucha_id = target_hucha_id
            if target_gasto_hucha_id:
                huchas_state[target_gasto_hucha_id]["saldo_actual"] -= amount

        if target_gasto_hucha_id:
            movimiento["hucha_id"] = target_gasto_hucha_id

        # Mark as recorded and save movement
        transaction.set(mov_refs[movements_to_process.index(m)], movimiento)
        recorded_ids.append(doc_id)
        
        if not movimiento.get("es_interno", False):
            if movimiento["tipo"] == "ingreso":
                stats_changes["ingresos"] += amount
            else:
                stats_changes["gastos"] += amount

    # Apply all writes at the end
    if new_hucha_ref and new_hucha_data:
        transaction.set(new_hucha_ref, new_hucha_data)
        logger.info(f"Created default hucha {new_hucha_ref.id} with balance {new_hucha_data['saldo_acumulado']:.2f}")

    for h_id, h_info in huchas_state.items():
        original_balance = float(h_info["data"].get("saldo_acumulado", 0) or 0)
        original_deuda = float(h_info["data"].get("deuda_pendiente", 0) or 0)
        
        new_balance = h_info["saldo_actual"]
        new_deuda = h_info.get("deuda_actual", original_deuda)
        
        if abs(new_balance - original_balance) > 0.001 or abs(new_deuda - original_deuda) > 0.001:  # if changed
            # Don't update the new default hucha twice if we just created it
            if new_hucha_ref and h_id == new_hucha_ref.id:
                continue
            
            update_data = {
                "saldo_acumulado": new_balance,
                "updated_at": firestore.SERVER_TIMESTAMP
            }
            if abs(new_deuda - original_deuda) > 0.001:
                update_data["deuda_pendiente"] = new_deuda
                if new_deuda == 0:
                    update_data["deuda_con"] = firestore.DELETE_FIELD
                
            transaction.update(h_info["ref"], update_data)
            logger.info(f"Updated hucha {h_id} balance by {new_balance - original_balance:.2f} (New: {new_balance:.2f}), deuda: {new_deuda:.2f}")

    # Update stats
    if stats_changes["ingresos"] > 0 or stats_changes["gastos"] > 0:
        current_stats = stats_snapshot.to_dict() or {}
        transaction.set(stats_ref, {
            "total_ingresos": current_stats.get("total_ingresos", 0) + stats_changes["ingresos"],
            "total_gastos": current_stats.get("total_gastos", 0) + stats_changes["gastos"],
            "updated_at": firestore.SERVER_TIMESTAMP,
        })

    return recorded_ids

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

def save_to_pending_review(email: Dict[str, Any], motivo: str) -> bool:
    """
    Saves a raw email that failed parsing or had low confidence to Firestore for manual review.
    """
    try:
        doc_id = email["id"]
        pending_ref = db.collection("correos_pendientes").document(doc_id)
        
        # Check if already exists to avoid duplicate entries
        if pending_ref.get().exists:
            return False
            
        pending_ref.set({
            "id_propietario": UID_PROPIETARIO,
            "email_id": email["id"],
            "cuerpo": email["body"],
            "fecha_envio": email["date_sent"],
            "motivo": motivo,
            "procesado": False,
            "created_at": firestore.SERVER_TIMESTAMP
        })
        logger.info(f"Email {email['id']} saved to manual review queue. Reason: {motivo}")
        return True
    except Exception as e:
        logger.error(f"Failed to save email {email['id']} to pending review: {e}")
        return False

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
            # Movimiento ignorado o fallido
            save_to_pending_review(email, "Fallo total en extracción automática")
            if mark_email_as_read(email_id):
                logger.info(f"Email {email_id} marked as read.")
            else:
                logger.error(f"Failed to mark email {email_id} as read.")
            continue

        # Ensure we have a list of movements
        movements_list = raw_movements if isinstance(raw_movements, list) else [raw_movements]
        
        has_recorded_any = False
        has_low_confidence = False
        
        movements_to_process = []
        
        for index, parsed_data in enumerate(movements_list):
            if not validate_parsed_data(parsed_data):
                logger.warning(f"Movement {index} from email {email_id} discarded: Invalid data.")
                has_low_confidence = True
                continue

            # Confidence Threshold Check
            ai_confidence = parsed_data.get("confianza", "baja").lower()
            if get_confidence_score(ai_confidence) < get_confidence_score(MIN_CONFIDENCE_THRESHOLD):
                logger.warning(f"Movement {index} from email {email_id} discarded: Confidence '{ai_confidence}' below threshold.")
                has_low_confidence = True
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
                "es_interno": bool(parsed_data.get("es_interno", False)),
                "created_at": firestore.SERVER_TIMESTAMP,
                "email_id": email_id
            }
            
            movements_to_process.append({
                "doc_id": doc_id,
                "index": index,
                "movimiento": movimiento
            })
            
        if movements_to_process:
            try:
                transaction = db.transaction()
                recorded_ids = process_email_movements_transaction(transaction, movements_to_process, UID_PROPIETARIO)
                
                if recorded_ids:
                    has_recorded_any = True
                    for m in movements_to_process:
                        if m["doc_id"] in recorded_ids:
                            logger.info(f"Movement {m['doc_id']} (index {m['index']}) recorded successfully.")
                        else:
                            logger.info(f"Movement {m['doc_id']} (index {m['index']}) already exists. Skipping.")
                    
                    try:
                        db.collection("correos_historico").document(email_id).set({
                            "id_propietario": UID_PROPIETARIO,
                            "email_id": email_id,
                            "cuerpo": email["body"],
                            "fecha_envio": email_date,
                            "movimientos_generados": recorded_ids,
                            "created_at": firestore.SERVER_TIMESTAMP
                        })
                        logger.info(f"Email {email_id} saved to correos_historico.")
                    except Exception as e:
                        logger.error(f"Failed to save email {email_id} to correos_historico: {e}")
                else:
                    logger.info(f"All movements for email {email_id} already existed. Skipping.")
            except Exception as e:
                logger.error(f"Error saving batch movements for email {email_id}: {e}")
                has_low_confidence = True

        if has_low_confidence and not has_recorded_any:
            save_to_pending_review(email, "Movimiento descartado por baja confianza o datos inválidos")

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
    if request.method != "POST":
        return ("Método no permitido", 405)

    setup_config()

    if not BANK_SENDER or not UID_PROPIETARIO:
        return ("Faltan variables de entorno", 500)

    # Check for authentication token
    webhook_token = os.getenv("WEBHOOK_TOKEN")
    if not webhook_token:
        logger.error("El webhook requiere autenticación (WEBHOOK_TOKEN no configurado).")
        return ("Configuración de servidor incompleta", 500)

    auth_header = request.headers.get("Authorization")
    
    token_valid = False
    if auth_header:
        expected_bearer = f"Bearer {webhook_token}"
        if hmac.compare_digest(auth_header, expected_bearer):
            token_valid = True
            
    if not token_valid:
        logger.warning("Intento de acceso no autorizado al Webhook.")
        return ("No autorizado", 401)

    try:
        logger.info("Webhook recibido. Comprobando correos nuevos...")
        process_emails()
        return ("Correos procesados correctamente", 200)
    except Exception as e:
        logger.error(f"Error en el Webhook: {e}")
        return ("Ocurrió un error interno al procesar los correos", 500)

if __name__ == "__main__":
    setup_config(parse_args())
    if not BANK_SENDER or not UID_PROPIETARIO:
        logger.error("BANK_SENDER o UID_PROPIETARIO no configurados.")
        exit(1)
    
    logger.info("Ejecución manual/programada iniciada...")
    process_emails()
    logger.info("Ejecución finalizada.")
