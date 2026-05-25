import os
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

# Añadir el directorio padre al path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main as backend_main
from firebase_admin import firestore

def parse_date_string(raw_fecha):
    if not raw_fecha:
        return None
    
    try:
        # Si tiene formato de header de correo (contiene coma o similar)
        if ',' in raw_fecha or ('+' in raw_fecha and len(raw_fecha) > 15):
            try:
                return parsedate_to_datetime(raw_fecha)
            except Exception:
                pass
                
        # Intentar formato ISO (por ejemplo, el de Gemini)
        if 'T' in raw_fecha:
            return datetime.fromisoformat(raw_fecha.replace('Z', '+00:00'))
            
        elif '-' in raw_fecha:
            # Formato YYYY-MM-DD
            parts = raw_fecha.split('-')
            if len(parts) == 3:
                return datetime(int(parts[0]), int(parts[1]), int(parts[2]), tzinfo=timezone.utc)
                
        elif '/' in raw_fecha:
            # Formato DD/MM/YYYY
            parts = raw_fecha.split('/')
            if len(parts) == 3:
                day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
                if year < 100: year += 2000
                return datetime(year, month, day, tzinfo=timezone.utc)
                
    except Exception as e:
        print(f"Error parsing date {raw_fecha}: {e}")
        
    return None

def main():
    backend_main.setup_config()
    
    if backend_main.db is None:
        print("ERROR: No se pudo inicializar la base de datos Firestore.")
        return
        
    print("--- INICIANDO MIGRACIÓN DE FECHAS EN FIRESTORE ---")
    print(f"Buscando movimientos para el usuario: {backend_main.UID_PROPIETARIO}...")
    
    movs_ref = backend_main.db.collection("movimientos")
    query = movs_ref.where("id_propietario", "==", backend_main.UID_PROPIETARIO)
    docs = list(query.stream())
    
    print(f"Se encontraron {len(docs)} movimientos en total.")
    updated_count = 0
    
    for doc in docs:
        data = doc.to_dict()
        fecha_val = data.get("fecha_operacion")
        
        # Si es un string, procedemos a migrarlo
        if isinstance(fecha_val, str):
            print(f"\nDetectado movimiento con fecha en formato String:")
            print(f"  ID: {doc.id}")
            print(f"  Concepto: {data.get('concepto')}")
            print(f"  Fecha String: '{fecha_val}'")
            
            fecha_dt = parse_date_string(fecha_val)
            if not fecha_dt:
                fecha_dt = datetime.now(timezone.utc)
            
            print(f"  -> Convirtiendo a Timestamp: {fecha_dt}")
            
            # Actualizar en Firestore
            doc.reference.update({
                "fecha_operacion": fecha_dt
            })
            updated_count += 1
            
    print(f"\n--- MIGRACIÓN COMPLETADA ---")
    print(f"Total de movimientos actualizados a Timestamp: {updated_count}")

if __name__ == "__main__":
    main()
