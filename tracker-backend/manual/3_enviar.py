import os
import json
import hashlib
import sys
from datetime import datetime

# Añadir el directorio padre al path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main as backend_main
from firebase_admin import firestore

def main():
    # Inicializar configuración y Firebase
    backend_main.setup_config()
    
    if backend_main.db is None:
        print("ERROR: No se pudo inicializar la base de datos Firestore.")
        return
    
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    input_path = os.path.join(temp_dir, "movimientos_a_subir.json")
    
    if not os.path.exists(input_path):
        print("ERROR: No se encuentra 'manual/temp/movimientos_a_subir.json'. Ejecuta primero 2_parsear.py")
        return

    print(f"--- PASO 3: ENVIAR A FIRESTORE ---")
    
    with open(input_path, "r", encoding="utf-8") as f:
        movimientos = json.load(f)

    if not movimientos:
        print("No hay movimientos para subir.")
        return

    print(f"Subiendo {len(movimientos)} movimientos...")
    
    emails_to_mark = set()
    success_count = 0

    for index, data in enumerate(movimientos):
        email_id = data.get("email_id", f"manual_{index}")
        
        # Generar ID determinista para evitar duplicados si se lanza dos veces
        unique_id = f"{email_id}_{index}"
        doc_id = hashlib.sha256(unique_id.encode()).hexdigest()
        
        # Preparar documento para Firestore
        movimiento_doc = {
            "id_propietario": backend_main.UID_PROPIETARIO,
            "tipo": data["tipo"],
            "concepto": data.get("descripcion") or data.get("concepto") or "Movimiento Manual",
            "importe": float(data["importe"]),
            "moneda": data.get("moneda", "EUR"),
            "fecha_operacion": data["fecha"],
            "confianza": data.get("confianza", "manual"),
            "version_prompt": "manual_v1",
            "created_at": firestore.SERVER_TIMESTAMP,
            "email_id": email_id
        }

        try:
            mov_ref = backend_main.db.collection("movimientos").document(doc_id)
            transaction = backend_main.db.transaction()
            
            # Usamos la misma lógica de transacción de main.py para que se distribuyan los fondos en las huchas
            was_recorded = backend_main.process_movement_transaction(transaction, mov_ref, movimiento_doc, backend_main.UID_PROPIETARIO)
            
            if was_recorded:
                print(f"OK: [{index+1}/{len(movimientos)}] Movimiento subido: {movimiento_doc['concepto'][:30]}... ({movimiento_doc['importe']} {movimiento_doc['moneda']})")
                success_count += 1
            else:
                print(f"INFO: [{index+1}/{len(movimientos)}] Ya existía en la DB: {doc_id[:10]}...")
            
            if not email_id.startswith("manual_"):
                emails_to_mark.add(email_id)
                
        except Exception as e:
            print(f"ERROR: Error al subir movimiento {index+1}: {e}")

    print(f"\nResumen: {success_count} nuevos movimientos registrados.")

    # Auto-marcar como leídos (sin preguntar para permitir ejecución fluida)
    if emails_to_mark:
        print(f"\nMarcando {len(emails_to_mark)} correos originales como LEIDOS en Gmail...")
        for eid in emails_to_mark:
            if backend_main.mark_email_as_read(eid):
                print(f"Correo {eid} procesado.")
            else:
                print(f"Error al marcar correo {eid}.")
    
    print("\nOK: Proceso finalizado.")

if __name__ == "__main__":
    main()
