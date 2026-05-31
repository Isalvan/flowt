import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace process_movement_transaction
old_func = re.search(r'@firestore\.transactional\ndef process_movement_transaction.*?return True\n', content, re.DOTALL)
new_func = """@firestore.transactional
def process_email_movements_transaction(transaction, movements_to_process: List[Dict], owner_id: str):
    \"\"\"
    Firestore transaction to save MULTIPLE movements and update huchas.
    movements_to_process is a list of dicts: {"doc_id": "...", "movimiento": {...}}
    Returns the list of doc_ids that were actually recorded.
    \"\"\"
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
            "saldo_actual": float(data.get("saldo_acumulado", 0) or 0)
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
                # 1. Flat amounts (HARD LIMIT)
                for h_id, h_info in huchas_state.items():
                    data = h_info["data"]
                    if data.get("tipo_aportacion") == "flat":
                        target_val = float(data.get("valor_aportacion", 0))
                        current_balance = h_info["saldo_actual"]
                        
                        # HARD LIMIT calculation
                        hueco_libre = max(0, target_val - current_balance)
                        
                        # Apply provisions subtraction logic to the hueco_libre
                        if h_id == subs_hucha_id:
                            provision_from_others = sum(linked_provisions.values())
                            effective_target = max(0, hueco_libre - provision_from_others)
                        else:
                            provision_for_subs = linked_provisions.get(h_id, 0)
                            effective_target = max(0, hueco_libre - provision_for_subs)
                            
                            # Add provision to Subs hucha instead of this hucha
                            if provision_for_subs > 0 and subs_hucha_id and remaining_amount > 0:
                                to_subs = min(provision_for_subs, remaining_amount)
                                huchas_state[subs_hucha_id]["saldo_actual"] += to_subs
                                remaining_amount -= to_subs
                        
                        to_add = min(effective_target, remaining_amount)
                        if to_add > 0:
                            huchas_state[h_id]["saldo_actual"] += to_add
                            remaining_amount -= to_add

                # 2. Percentages
                for h_id, h_info in huchas_state.items():
                    data = h_info["data"]
                    if data.get("tipo_aportacion") == "porcentaje":
                        perc_val = float(data.get("valor_aportacion", 0))
                        planned_total = amount * (perc_val / 100.0)
                        
                        provision_for_subs = linked_provisions.get(h_id, 0)
                        effective_target = max(0, planned_total - provision_for_subs)
                        
                        # Add provision to Subs hucha
                        if provision_for_subs > 0 and subs_hucha_id and remaining_amount > 0:
                            to_subs = min(provision_for_subs, remaining_amount)
                            huchas_state[subs_hucha_id]["saldo_actual"] += to_subs
                            remaining_amount -= to_subs

                        to_add = min(effective_target, remaining_amount)
                        if to_add > 0:
                            huchas_state[h_id]["saldo_actual"] += to_add
                            remaining_amount -= to_add

                # 3. Resto (Income Overflow)
                resto_hucha_id = next((h_id for h_id, h_info in huchas_state.items() if h_info["data"].get("tipo_aportacion") == "resto"), None)
                if not resto_hucha_id:
                    resto_hucha_id = next((h_id for h_id, h_info in huchas_state.items() if h_info["data"].get("es_principal")), None)
                if not resto_hucha_id and huchas_state:
                    resto_hucha_id = list(huchas_state.keys())[0]
                
                if resto_hucha_id and remaining_amount > 0:
                    huchas_state[resto_hucha_id]["saldo_actual"] += remaining_amount
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
        new_balance = h_info["saldo_actual"]
        if abs(new_balance - original_balance) > 0.001:  # if changed
            # Don't update the new default hucha twice if we just created it
            if new_hucha_ref and h_id == new_hucha_ref.id:
                continue
            transaction.update(h_info["ref"], {
                "saldo_acumulado": new_balance,
                "updated_at": firestore.SERVER_TIMESTAMP
            })
            logger.info(f"Updated hucha {h_id} balance by {new_balance - original_balance:.2f} (New: {new_balance:.2f})")

    # Update stats
    if stats_changes["ingresos"] > 0 or stats_changes["gastos"] > 0:
        current_stats = stats_snapshot.to_dict() or {}
        transaction.set(stats_ref, {
            "total_ingresos": current_stats.get("total_ingresos", 0) + stats_changes["ingresos"],
            "total_gastos": current_stats.get("total_gastos", 0) + stats_changes["gastos"],
            "updated_at": firestore.SERVER_TIMESTAMP,
        })

    return recorded_ids
"""

content = content.replace(old_func.group(0), new_func)

# Replace loop logic
old_loop = re.search(r'        for index, parsed_data in enumerate\(movements_list\):.*?        if has_low_confidence and not has_recorded_any:', content, re.DOTALL)
new_loop = """        movements_to_process = []
        
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
                else:
                    logger.info(f"All movements for email {email_id} already existed. Skipping.")
            except Exception as e:
                logger.error(f"Error saving batch movements for email {email_id}: {e}")
                has_low_confidence = True

        if has_low_confidence and not has_recorded_any:"""

content = content.replace(old_loop.group(0), new_loop)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
