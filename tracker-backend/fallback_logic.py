import re
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

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
            try:
                # Convert "1.200,42" to 1200.42
                raw_val = amount_match.group(1).replace(".", "").replace(",", ".")
                importe = float(raw_val)
            except: pass

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

