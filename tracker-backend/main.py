import os
import json
import hashlib
import subprocess
import logging
import shutil
import argparse
import signal
import tempfile
import re
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

from gmail_client import get_unread_emails_from_bank, mark_email_as_read

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

def strip_non_cp1252(text: str) -> str:
    """
    Removes characters that cannot be encoded in cp1252 (Windows default).
    This prevents 'charmap' codec crashes on Windows shells/pipes.
    """
    if not text:
        return text
    # Encode to cp1252 and ignore errors, then decode back to string
    return text.encode('cp1252', errors='ignore').decode('cp1252')

def terminate_process_tree(process: subprocess.Popen) -> None:
    """
    Kills the full Gemini process tree to avoid zombie/child hangs.
    """
    if process.poll() is not None:
        return

    try:
        if os.name == 'nt':
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10
            )
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except Exception:
        process.kill()

def parse_amount(amount_text: str) -> Optional[float]:
    if not amount_text:
        return None
    normalized = amount_text.replace(" ", "")
    # 1.234,56 -> 1234.56
    if "," in normalized and "." in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")
    else:
        normalized = normalized.replace(",", ".")
    try:
        return float(normalized)
    except ValueError:
        return None

def fallback_extract_movement(email_body: str, email_date: str) -> Optional[List[Dict[str, Any]]]:
    """
    Lightweight extractor used when Gemini CLI times out.
    """
    body = email_body or ""
    body_l = body.lower()

    amount = None
    currency = None

    amount_patterns = [
        r"(?:cargad[oa].{0,80}?cantidad de|importe de)\s*\*?([0-9\.\,]+)\s*([A-Z]{3}|EUR|USD|GBP)",
        r"([0-9\.\,]+)\s*(EUR|USD|GBP|[A-Z]{3})"
    ]

    for pattern in amount_patterns:
        match = re.search(pattern, body, re.IGNORECASE | re.DOTALL)
        if match:
            amount = parse_amount(match.group(1))
            currency = (match.group(2) or "").upper()
            if amount is not None:
                break

    concept_match = re.search(r"concepto(?:\s+de)?\s*[:\-]?\s*\*?([^*\n\.]+)", body, re.IGNORECASE)
    concept = concept_match.group(1).strip() if concept_match else None

    is_gasto = any(k in body_l for k in ["cargo", "compra", "pago", "domiciliaci", "retirada"])
    is_ingreso = any(k in body_l for k in ["abono", "ingreso", "transferencia entrante", "devoluci", "nómina", "nomina"])

    if is_gasto and not is_ingreso:
        tipo = "gasto"
    elif is_ingreso and not is_gasto:
        tipo = "ingreso"
    else:
        tipo = None

    try:
        dt = parsedate_to_datetime(email_date)
        fecha_iso = dt.isoformat()
    except Exception:
        fecha_iso = None

    if tipo is None or amount is None:
        return None

    if concept:
        descripcion = f"{'Cargo' if tipo == 'gasto' else 'Abono'} {concept}".strip()
    else:
        descripcion = "Movimiento bancario detectado"

    return [{
        "tipo": tipo,
        "importe": amount,
        "moneda": currency or "EUR",
        "fecha": fecha_iso,
        "descripcion": descripcion[:100],
        "confianza": "media"
    }]

# --- Core Logic ---

def call_gemini_cli(email_body: str, email_date: str) -> Optional[Dict[str, Any]]:
    """
    Calls the Gemini CLI to parse the email body using the prompt file and JSON schema.
    """
    prompt_path = os.path.join(os.path.dirname(__file__), "prompt.md")
    schema_path = os.path.join(os.path.dirname(__file__), "schema.json")
    gemini_path = shutil.which("gemini")

    if not gemini_path:
        logger.error("Gemini CLI executable not found in PATH.")
        return None

    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_content = f.read()

        with open(schema_path, 'r', encoding='utf-8') as f:
            schema_content = f.read()

        full_input = (
            f"{prompt_content}\n\n"
            f"MANDATORY JSON SCHEMA:\n{schema_content}\n\n"
            f"FECHA DE ENVÍO DEL CORREO: {email_date}\n\n"
            f"[INICIO DEL CORREO]\n{email_body}\n[FIN DEL CORREO]"
        )

        # Clean input for Windows cp1252 compatibility (strips emojis, etc.)
        full_input = strip_non_cp1252(full_input)

        if args.verbose:
            logger.debug(f"--- Gemini CLI Input ---\n{full_input}\n--- End Input ---")
        
        # Define command in non-interactive mode.
        # On Windows, .cmd launchers are more stable through cmd /c.
        prompt_instruction = "Analiza el correo y devuelve estrictamente un JSON que cumpla el esquema indicado."
        if os.name == 'nt' and gemini_path.lower().endswith(('.cmd', '.bat')):
            cmd = ["cmd.exe", "/c", gemini_path, "-m", AI_MODEL, "-p", prompt_instruction]
        else:
            cmd = [gemini_path, "-m", AI_MODEL, "-p", prompt_instruction]

        timeout_seconds = int(os.getenv("GEMINI_TIMEOUT_SECONDS", "120"))
        env = os.environ.copy()
        env.setdefault("CI", "1")
        env.setdefault("GEMINI_DISABLE_EXTENSIONS", "1")
        env.setdefault("GEMINI_NO_HOOKS", "1")

        temp_prompt_path = None
        try:
            # Avoid stdin deadlocks in Windows shells by passing prompt through @temp_file.
            # Gemini CLI accepts "-p @<file_path>" to load prompt content from disk.
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".txt",
                delete=False,
                encoding="utf-8",
                newline="\n"
            ) as temp_prompt_file:
                temp_prompt_file.write(full_input)
                temp_prompt_path = temp_prompt_file.name

            cmd = cmd[:-1] + [f"@{temp_prompt_path}"]
            if args.verbose:
                logger.debug(f"Launching Gemini CLI (timeout={timeout_seconds}s): {' '.join(cmd)}")

            popen_kwargs = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
                "encoding": "utf-8",
                "errors": "replace",
                "shell": False,
                "env": env
            }
            if os.name == 'nt':
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                popen_kwargs["preexec_fn"] = os.setsid

            process = subprocess.Popen(
                cmd,
                **popen_kwargs
            )
            stdout, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            terminate_process_tree(process)
            logger.error(f"Timeout calling Gemini CLI after {timeout_seconds}s.")
            fallback_data = fallback_extract_movement(email_body, email_date)
            if fallback_data:
                logger.warning("Using regex fallback extraction after Gemini timeout.")
                return fallback_data
            return None
        except Exception as e:
            logger.error(f"Error calling Gemini CLI: {e}")
            return None
        finally:
            if temp_prompt_path and os.path.exists(temp_prompt_path):
                try:
                    os.remove(temp_prompt_path)
                except Exception:
                    pass
        
        if process.returncode != 0:
            logger.error(f"Gemini CLI error: {stderr}")
            fallback_data = fallback_extract_movement(email_body, email_date)
            if fallback_data:
                logger.warning("Using regex fallback extraction after Gemini non-zero exit.")
                return fallback_data
            return None
        
        output = stdout.strip()
        if args.verbose:
            logger.debug(f"--- Gemini CLI Raw Output ---\n{output}\n--- End Output ---")

        # Extract JSON content even if there's noise around it
        if "```json" in output:
            output = output.split("```json")[1].split("```")[0].strip()
        elif "```" in output:
            output = output.split("```")[1].split("```")[0].strip()
        else:
            # Find the first '[' or '{' and the last ']' or '}'
            import re
            match = re.search(r'([\[\{].*[\]\}])', output, re.DOTALL)
            if match:
                output = match.group(1).strip()
            
        return json.loads(output)
    except subprocess.TimeoutExpired:
        logger.error("Timeout calling Gemini CLI.")
        return None
    except Exception as e:
        logger.error(f"Error processing with Gemini: {e}")
        return None

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

def process_emails():
    """
    Main processing loop.
    """
    emails = get_unread_emails_from_bank(BANK_SENDER, MAX_EMAILS_PER_RUN)
    
    for email in emails:
        email_id = email["id"]
        # message_id = email["message_id"] # We'll use email_id for more consistent testing
        email_date = email["date_sent"]
        
        raw_movements = call_gemini_cli(email["body"], email_date)
        
        if not raw_movements:
            logger.warning(f"Email {email_id} discarded: No data returned from AI.")
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
            
            # Construct movement document
            movimiento = {
                "id_propietario": UID_PROPIETARIO,
                "tipo": parsed_data["tipo"],
                "concepto": parsed_data.get("descripcion") or parsed_data.get("concepto") or "Sin concepto",
                "importe": float(parsed_data["importe"]),
                "moneda": parsed_data.get("moneda", "EUR"),
                "fecha_operacion": parsed_data["fecha"],
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

import time

def run_tracker_app():
    """
    Runs the tracker app continuously with a cooldown and retries.
    """
    logger.info("Starting Tracker App. Press Ctrl+C to exit.")
    cooldown_seconds = 120  # 2 minutes
    max_retries = 3
    
    while True:
        retries = 0
        success = False
        
        while retries < max_retries and not success:
            try:
                logger.info("Checking for new bank emails...")
                process_emails()
                success = True
            except Exception as e:
                retries += 1
                logger.error(f"Error during email processing (Attempt {retries}/{max_retries}): {e}")
                if retries < max_retries:
                    time.sleep(5)  # Short wait before retry
                
        if not success:
            logger.error("Max retries reached. Waiting for next cycle.")
            
        logger.info(f"Sleeping for {cooldown_seconds // 60} minutes...")
        time.sleep(cooldown_seconds)

if __name__ == "__main__":
    setup_config(parse_args())
    if not BANK_SENDER or not UID_PROPIETARIO:
        logger.error("BANK_SENDER or UID_PROPIETARIO not set in .env")
        exit(1)
        
    run_tracker_app()
