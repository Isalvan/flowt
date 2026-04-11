import os
import json
import hashlib
import subprocess
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

from gmail_client import get_unread_emails_from_bank, mark_email_as_read

# --- Configuration & Initialization ---

# Load environment variables
load_dotenv()

BANK_SENDER = os.getenv("BANK_SENDER")
UID_PROPIETARIO = os.getenv("UID_PROPIETARIO")
MAX_EMAILS_PER_RUN = int(os.getenv("MAX_EMAILS_PER_RUN", "10"))
PROMPT_VERSION = "v1"

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("tracker.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Initialize Firebase
try:
    # Look for serviceAccountKey.json in the same directory as the script
    cred_path = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
    if os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
    else:
        # Fallback to default credentials (e.g. for local emulators or GCP environment)
        firebase_admin.initialize_app()
    db = firestore.client()
    logger.info("Firebase initialized successfully.")
except Exception as e:
    logger.error(f"Failed to initialize Firebase: {e}")
    exit(1)

# --- Mock Data & Functions ---

def get_unread_emails_from_bank() -> List[Dict[str, str]]:
    """
    Mocks the retrieval of unread emails from the bank.
    In a real scenario, this would call a Gmail MCP or API.
    """
    # Dummy data for testing
    return [
        {
            "id": "msg-12345",
            "from": BANK_SENDER,
            "body": "Has recibido un Bizum de 50.00 EUR de Juan Perez el 2024-10-25.",
            "subject": "Notificación de Ingreso"
        },
        {
            "id": "msg-67890",
            "from": BANK_SENDER,
            "body": "Compra en MERCADONA por importe de 25.50 EUR el 2024-10-25.",
            "subject": "Notificación de Gasto"
        }
    ][:MAX_EMAILS_PER_RUN]

# --- Core Logic ---

def call_gemini_cli(email_body: str) -> Optional[Dict[str, Any]]:
    """
    Calls the Gemini CLI to parse the email body using the prompt file.
    """
    prompt_path = os.path.join(os.path.dirname(__file__), "prompt.md")
    
    try:
        # gemini ask --prompt-file prompt.md "email body"
        # We use shell=False for security as per INSTRUCTIONS.md
        process = subprocess.Popen(
            ["gemini", "ask", "--prompt-file", prompt_path, email_body],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = process.communicate(timeout=30)
        
        if process.returncode != 0:
            logger.error(f"Gemini CLI error: {stderr}")
            return None
        
        # Extract JSON from stdout (Gemini might return markdown blocks)
        output = stdout.strip()
        if "```json" in output:
            output = output.split("```json")[1].split("```")[0].strip()
        elif "```" in output:
            output = output.split("```")[1].split("```")[0].strip()
            
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
def distribute_to_huchas(transaction, movement_ref, amount: float, owner_id: str):
    """
    Firestore transaction to distribute an income among huchas.
    """
    huchas_ref = db.collection("huchas")
    query = huchas_ref.where("id_propietario", "==", owner_id).order_by("orden")
    
    # Get all huchas for the owner - ALL READS MUST HAPPEN FIRST
    huchas_docs = list(query.stream(transaction=transaction))
    
    if not huchas_docs:
        logger.warning(f"No huchas found for user {owner_id}. Income not distributed.")
        return

    # Validate percentages using to_dict().get() for safety
    total_percentage = sum(
        doc.to_dict().get("valor_aportacion", 0) 
        for doc in huchas_docs 
        if doc.to_dict().get("tipo_aportacion") == "porcentaje"
    )
    if total_percentage > 100:
        logger.error(f"Total percentage ({total_percentage}%) exceeds 100% for user {owner_id}.")
        return

    remaining_amount = amount
    distributions = {} # doc_id -> amount_to_add
    
    # 1. Flat amounts
    for doc in huchas_docs:
        data = doc.to_dict()
        if data.get("tipo_aportacion") == "flat":
            flat_val = float(data.get("valor_aportacion", 0))
            to_add = min(flat_val, remaining_amount)
            distributions[doc.id] = to_add
            remaining_amount -= to_add

    # 2. Percentages (calculated from the ORIGINAL amount)
    for doc in huchas_docs:
        data = doc.to_dict()
        if data.get("tipo_aportacion") == "porcentaje":
            perc_val = float(data.get("valor_aportacion", 0))
            to_add = amount * (perc_val / 100.0)
            # We don't subtract from remaining_amount yet to allow percentages to be of the total
            # but we must ensure we don't distribute more than we have left
            to_add = min(to_add, remaining_amount)
            distributions[doc.id] = distributions.get(doc.id, 0) + to_add
            remaining_amount -= to_add

    # 3. Remainder (Resto) or Principal
    resto_hucha = next((doc for doc in huchas_docs if doc.to_dict().get("tipo_aportacion") == "resto"), None)
    if not resto_hucha:
        resto_hucha = next((doc for doc in huchas_docs if doc.to_dict().get("es_principal")), None)
    
    if resto_hucha and remaining_amount > 0:
        distributions[resto_hucha.id] = distributions.get(resto_hucha.id, 0) + remaining_amount
        remaining_amount = 0

    # Apply updates - ALL WRITES MUST HAPPEN AFTER ALL READS
    for hucha_id, add_amount in distributions.items():
        hucha_ref = huchas_ref.document(hucha_id)
        # Find the snapshot we already read to get the current balance
        hucha_snapshot = next(doc for doc in huchas_docs if doc.id == hucha_id)
        current_balance = hucha_snapshot.to_dict().get("saldo_acumulado", 0) or 0
        transaction.update(hucha_ref, {
            "saldo_acumulado": current_balance + add_amount
        })
        logger.info(f"Distributed {add_amount:.2f} to hucha {hucha_id}")

def process_emails():
    """
    Main processing loop.
    """
    emails = get_unread_emails_from_bank(BANK_SENDER, MAX_EMAILS_PER_RUN)
    
    for email in emails:
        email_id = email["id"]
        message_id = email.get("message_id", email_id)
        
        # Security check: Exact sender match
        if email["from"] != BANK_SENDER:
            logger.warning(f"Skipping email from unknown sender: {email['from']}")
            continue
            
        logger.info(f"Processing email {email_id} (Message-ID: {message_id})...")
        
        parsed_data = call_gemini_cli(email["body"])
        
        if not parsed_data or not validate_parsed_data(parsed_data):
            logger.warning(f"Email {email_id} discarded: Invalid or empty data from AI.")
            # In a real scenario, we might mark it as read anyway if it's not a bank movement
            continue
            
        # Generate secure ID
        doc_id = hashlib.sha256(message_id.encode()).hexdigest()
        
        # Construct movement document
        # Map fields from prompt.md to INSTRUCTIONS.md schema
        movimiento = {
            "id_propietario": UID_PROPIETARIO,
            "tipo": parsed_data["tipo"],
            "concepto": parsed_data.get("descripcion", "Sin concepto"),
            "importe": float(parsed_data["importe"]),
            "fecha_operacion": parsed_data["fecha"], # Assuming ISO 8601 from AI
            "version_prompt": PROMPT_VERSION,
            "created_at": firestore.SERVER_TIMESTAMP
        }
        
        try:
            # Write to Firestore
            mov_ref = db.collection("movimientos").document(doc_id)
            mov_ref.set(movimiento)
            logger.info(f"Movement {doc_id} recorded successfully.")
            
            # If income, distribute to huchas
            if movimiento["tipo"] == "ingreso":
                transaction = db.transaction()
                distribute_to_huchas(transaction, mov_ref, movimiento["importe"], UID_PROPIETARIO)
                
            # Mark as read
            if mark_email_as_read(email_id):
                logger.info(f"Email {email_id} marked as processed.")
            else:
                logger.error(f"Failed to mark email {email_id} as read.")
            
        except Exception as e:
            logger.error(f"Error writing to Firestore for email {email_id}: {e}")

if __name__ == "__main__":
    if not BANK_SENDER or not UID_PROPIETARIO:
        logger.error("BANK_SENDER or UID_PROPIETARIO not set in .env")
        exit(1)
        
    process_emails()
