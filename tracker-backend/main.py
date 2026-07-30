# -*- coding: cp1252 -*-
import os
import subprocess
import hashlib
import logging
import argparse
import re
import unicodedata
from calendar import monthrange
from email.utils import parsedate_to_datetime
from datetime import date, datetime, timezone
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




def validate_parsed_data(data: Dict[str, Any], email_body: str) -> bool:
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
        
    if data.get("moneda", "EUR") != "EUR":
        return False
        
    concepto = data.get("descripcion") or data.get("concepto") or ""
    if len(concepto) > 100:
        return False
        
    if data.get("confianza", "alta") not in ["alta", "media", "baja"]:
        return False
        
    # Check if amount digits are somewhat in the text
    importe_str = str(importe)
    if importe_str.endswith(".0"):
        importe_str = importe_str[:-2]
    digits = re.sub(r'\D', '', importe_str)
    if digits and digits not in re.sub(r'\D', '', email_body):
        return False
    
    return True


FREQUENCY_DIVISORS = {"mensual": 1, "trimestral": 3, "semestral": 6, "anual": 12}


def normalize_subscription_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    without_accents = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", without_accents.lower()).strip()


def subscription_monthly_amount(subscription: Dict[str, Any]) -> float:
    effective = subscription.get("mi_parte")
    if effective is None:
        effective = subscription.get("importe", 0)
    divisor = FREQUENCY_DIVISORS.get(subscription.get("frecuencia", "mensual"), 1)
    return float(effective or 0) / divisor


def find_subscription_hucha(
    movimiento: Dict[str, Any],
    subscriptions: List[Dict[str, Any]],
    huchas_state: Dict[str, Dict[str, Any]],
    default_hucha_id: Optional[str],
) -> Optional[str]:
    """Resolve a real bank charge to its configured subscription wallet."""
    concept = normalize_subscription_text(movimiento.get("concepto", ""))
    amount = float(movimiento.get("importe", 0) or 0)
    scored = []

    for subscription in subscriptions:
        name = normalize_subscription_text(subscription.get("nombre", ""))
        full_amount = float(subscription.get("importe", 0) or 0)
        name_match = len(name) >= 3 and bool(concept) and (name in concept or concept in name)
        amount_match = abs(full_amount - amount) <= 0.02
        if not name_match and not amount_match:
            continue
        score = (100 + len(name) if name_match else 0) + (20 if amount_match else 0)
        scored.append((score, subscription))

    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    if scored[0][0] < 100 and len([item for item in scored if item[0] == scored[0][0]]) > 1:
        return None

    configured = scored[0][1].get("hucha_id")
    if configured in huchas_state:
        return configured
    return default_hucha_id if default_hucha_id in huchas_state else None


def as_local_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def subscription_cancellation_date(subscription: Dict[str, Any], today: Optional[date] = None) -> Optional[date]:
    explicit = as_local_date(subscription.get("cancel_at"))
    if explicit:
        return explicit
    if not subscription.get("cancelando"):
        return None

    requested = as_local_date(subscription.get("updated_at")) or today or datetime.now(timezone.utc).date()
    anchor = (
        as_local_date(subscription.get("fecha_inicio"))
        or as_local_date(subscription.get("created_at"))
        or requested
    )
    cadence = FREQUENCY_DIVISORS.get(subscription.get("frecuencia", "mensual"), 1)
    payment_day = int(subscription.get("dia_pago") or anchor.day)

    for offset in range(121):
        absolute_month = requested.year * 12 + requested.month - 1 + offset
        year, zero_based_month = divmod(absolute_month, 12)
        month = zero_based_month + 1
        month_distance = (year - anchor.year) * 12 + month - anchor.month
        if month_distance < 0 or month_distance % cadence != 0:
            continue
        candidate = date(year, month, min(payment_day, monthrange(year, month)[1]))
        if candidate > requested:
            return candidate
    return None


def process_expired_subscriptions(owner_id: str, today: Optional[date] = None) -> int:
    """Delete due cancellations and keep the automatic wallet target in sync."""
    today = today or datetime.now(timezone.utc).date()
    subscriptions_ref = db.collection("suscripciones")
    subscription_docs = list(subscriptions_ref.where("id_propietario", "==", owner_id).stream())
    expired = [
        doc for doc in subscription_docs
        if subscription_cancellation_date(doc.to_dict(), today)
        and subscription_cancellation_date(doc.to_dict(), today) <= today
    ]
    if not expired:
        return 0

    expired_ids = {doc.id for doc in expired}
    remaining = [doc.to_dict() for doc in subscription_docs if doc.id not in expired_ids]
    hucha_docs = list(db.collection("huchas").where("id_propietario", "==", owner_id).stream())
    subscriptions_hucha = next((doc for doc in hucha_docs if doc.to_dict().get("es_suscripciones")), None)
    monthly_total = round(sum(
        subscription_monthly_amount(subscription)
        for subscription in remaining
        if subscription.get("activa", False)
        and (
            not subscriptions_hucha
            or not subscription.get("hucha_id")
            or subscription.get("hucha_id") == subscriptions_hucha.id
        )
    ), 2)

    batch = db.batch()
    for subscription_doc in expired:
        batch.delete(subscription_doc.reference)
    if subscriptions_hucha:
        batch.update(subscriptions_hucha.reference, {
            "objetivo": monthly_total if monthly_total > 0 else None,
            "valor_aportacion": monthly_total,
            "tipo_aportacion": "flat",
            "tope_objetivo": False,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
    batch.commit()
    logger.info("Deleted %s expired subscription(s).", len(expired))
    return len(expired)

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

    # Active subscriptions are used to route matching bank charges.
    active_subscriptions = [doc.to_dict() for doc in subs_docs]
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
                        if data.get("tope_objetivo") and not data.get("es_suscripciones") and data.get("objetivo"):
                            objetivo = float(data.get("objetivo"))
                            if objetivo > 0:
                                current_balance = h_info["saldo_actual"]
                                hueco_libre = max(0, objetivo - current_balance)
                                planned_total = min(planned_total, hueco_libre)
                        
                        effective_target = planned_total
                        
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
                        
                        effective_target = planned_total

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
            target_hucha_id = find_subscription_hucha(
                movimiento,
                active_subscriptions,
                huchas_state,
                subs_hucha_id,
            )
            if not target_hucha_id:
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

MIN_CONFIDENCE_THRESHOLD = os.getenv("MIN_CONFIDENCE", "alta").lower()

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
    if UID_PROPIETARIO:
        process_expired_subscriptions(UID_PROPIETARIO)
    emails = get_unread_emails_from_bank(BANK_SENDER, MAX_EMAILS_PER_RUN)
    
    for email in emails:
        email_id = email["id"]
        
        sender_normalized = extract_email(email["from"])
        expected_sender = extract_email(BANK_SENDER) if BANK_SENDER else ""
        if expected_sender and expected_sender not in sender_normalized:
            logger.warning(f"Sender mismatch for {email_id}. Expected {expected_sender}, got {sender_normalized}")
            continue
            
        auth_results = email.get("auth_results", "").lower()
        if auth_results:
            if "spf=pass" not in auth_results and "dkim=pass" not in auth_results and "dmarc=pass" not in auth_results:
                logger.warning(f"Auth failed for {email_id}: {auth_results}")
                if save_to_pending_review(email, f"Fallo de autenticación: {auth_results}"):
                    mark_email_as_read(email_id)
                continue

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
            if save_to_pending_review(email, "Fallo total en extracción automática"):
                if mark_email_as_read(email_id):
                    logger.info(f"Email {email_id} marked as read.")
                else:
                    logger.error(f"Failed to mark email {email_id} as read.")
            continue

        # Ensure we have a list of movements
        movements_list = raw_movements if isinstance(raw_movements, list) else [raw_movements]
        
        if len(movements_list) > 10:
            logger.warning(f"Too many movements ({len(movements_list)}) in email {email_id}.")
            if save_to_pending_review(email, "Excede máximo de movimientos por correo"):
                mark_email_as_read(email_id)
            continue
        
        has_recorded_any = False
        has_low_confidence = False
        
        movements_to_process = []
        
        for index, parsed_data in enumerate(movements_list):
            if not validate_parsed_data(parsed_data, body_clean):
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

            if fecha_dt:
                try:
                    email_date_dt = parsedate_to_datetime(email_date)
                    if abs((fecha_dt - email_date_dt).days) > 7:
                        logger.warning(f"Date {fecha_dt} is too far from email date {email_date_dt}.")
                        has_low_confidence = True
                        continue
                except Exception:
                    pass

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
            if save_to_pending_review(email, "Movimiento descartado por baja confianza o datos inválidos"):
                if mark_email_as_read(email_id):
                    logger.info(f"Email {email_id} marked as processed.")
                else:
                    logger.error(f"Failed to mark email {email_id} as read.")
        else:
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

    # Check for authentication token
    webhook_token = os.getenv("WEBHOOK_TOKEN")
    if webhook_token:
        auth_header = request.headers.get("Authorization")
        auth_query = request.args.get("token")
        
        token_valid = False
        if auth_header:
            if auth_header == webhook_token or auth_header == f"Bearer {webhook_token}":
                token_valid = True
        elif auth_query:
            if auth_query == webhook_token:
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
