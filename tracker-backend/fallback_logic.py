import re
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

def parse_amount(amount_str: str) -> Optional[float]:
    """
    Parses a currency string into a float by robustly identifying decimal and
    thousands separators in both Spanish (1.200,50) and English (1,200.50) notations.
    """
    try:
        # Remove any whitespace
        amount_str = amount_str.replace(" ", "")
        
        # 1. Both dot and comma are present
        if "." in amount_str and "," in amount_str:
            if amount_str.find(".") < amount_str.find(","):
                # Spanish format: e.g. 1.234,56
                return float(amount_str.replace(".", "").replace(",", "."))
            else:
                # English format: e.g. 1,234.56
                return float(amount_str.replace(",", ""))
        
        # 2. Only comma is present
        if "," in amount_str:
            parts = amount_str.split(",")
            # Single comma followed by exactly 2 digits is standard Spanish decimal
            if len(parts) == 2 and len(parts[1]) == 2:
                return float(amount_str.replace(",", "."))
            # If multiple commas, it's English thousands format (e.g., 1,000,000)
            if amount_str.count(",") > 1:
                return float(amount_str.replace(",", ""))
            # Default single comma fallback to decimal separator
            return float(amount_str.replace(",", "."))
            
        # 3. Only dot is present
        if "." in amount_str:
            parts = amount_str.split(".")
            # Multiple dots are always Spanish thousands separators
            if amount_str.count(".") > 1:
                return float(amount_str.replace(".", ""))
            # Single dot followed by exactly 3 digits is standard Spanish thousands (e.g., 1.200 or 5.000)
            if len(parts) == 2 and len(parts[1]) == 3:
                return float(amount_str.replace(".", ""))
            # Default single dot is standard float (e.g., 4.42 or 12.5)
            return float(amount_str)
            
        # 4. Pure digits
        return float(amount_str)
    except Exception as e:
        logger.error(f"Failed to parse amount string '{amount_str}': {e}")
        return None

# Fallback logic for when AI fails
def fallback_extract_movement(body: str, email_date: str) -> Optional[List[Dict[str, Any]]]:
    """
    Attempts to extract transaction data using robust regex patterns 
    when the AI fails or times out.
    """
    try:
        # 1. Clean HTML first if possible
        if BeautifulSoup and ("<html" in body.lower() or "<body" in body.lower()):
            soup = BeautifulSoup(body, "html.parser")
            # Remove style and script tags
            for script_or_style in soup(["script", "style"]):
                script_or_style.decompose()
            text = soup.get_text(separator=" ")
        else:
            text = body
            
        # Clean body for consistent matching
        clean_text = text.replace("\r\n", " ").replace("\n", " ")
        # Remove multiple spaces
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()
        
        # 2. Extract Amount (looks for X,XX EUR/EUR X,XX)
        # Matches formats like 4,42 EUR or 1.200,00 EUR
        amount_match = re.search(r'(\d+[.,\d]*)\s*(?:EUR|€)', clean_text, re.IGNORECASE)
        if not amount_match:
            amount_match = re.search(r'(?:EUR|€)\s*(\d+[.,\d]*)', clean_text, re.IGNORECASE)
            
        importe = None
        if amount_match:
            importe = parse_amount(amount_match.group(1))

        # 3. Extract Type
        tipo = "gasto" # Default to gasto as bank notifications are usually charges
        income_keywords = [
            "abono",
            "ingreso",
            "nómina",
            "nomina",  # defensive: emails sometimes strip accents
            "transferencia recibida",
            "devolución",
            "devolucion",
            "reembolso",
        ]
        if any(word in clean_text.lower() for word in income_keywords):
            tipo = "ingreso"

        # 4. Extract Description
        # Look for phrases like "en [STUFF]", "operación de [AMOUNT] en [STUFF]", "autorizado... en [STUFF]"
        descripcion = "Extraccion manual fallback"
        
        # Specific patterns for Unicaja/Typical bank emails
        patterns = [
            r'en\s+([a-zA-Z0-9\s*]+)(?:,|\.|\s+para)', # authorized in STORE, for...
            r'concepto\s+([a-zA-Z0-9\s*]+)(?:\.|$)',    # concept ...
            r'comercio\s+([a-zA-Z0-9\s*]+)(?:\.|$)',    # commerce ...
        ]
        
        for pattern in patterns:
            match = re.search(pattern, clean_text, re.IGNORECASE)
            if match:
                extracted = match.group(1).strip()
                if extracted and len(extracted) > 2:
                    descripcion = extracted[:50]
                    break

        # Exclusion Rule: Ignore internal card recharges
        if "SISTEMA DE RECARGAS" in clean_text.upper() or "RECARGA" in clean_text.upper():
            logger.info("Internal recharge detected. Skipping as non-consumption.")
            return []

        # 5. Extract Date (fallback to email_date)
        # Try to find a date in DD/MM/YYYY or YYYY-MM-DD
        date_match = re.search(r'(\d{2}/\d{2}/\d{2,4})', clean_text)
        fecha = date_match.group(1) if date_match else email_date

        if importe is not None:
            return [{
                "tipo": tipo,
                "importe": importe,
                "moneda": "EUR",
                "fecha": fecha,
                "descripcion": f"[RESCUE] {descripcion}",
                "confianza": "baja"
            }]
    except Exception as e:
        logger.error(f"Fallback extraction failed: {e}")
    
    return None

