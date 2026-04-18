import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

def revert_movements():
    load_dotenv('tracker-backend/.env')
    cred_path = 'tracker-backend/serviceAccountKey.json'
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    # IDs of the incorrect movements
    ids_to_delete = [
        '1b2ced4e7a97d575787c8817dc57419936e402e510ef74db68a244e940df9f33', # 2 EUR
        '7437713293848cd8dcb7d1da77a596251f639481498d4de7e677d4972e6f0fe2'  # 5 EUR
    ]
    
    principal_hucha_id = 'hYpEkvuC37GXzCaomVPX' # "Personal"
    revert_amount = 7.0 # 5 + 2
    
    print(f"Borrando {len(ids_to_delete)} movimientos y devolviendo {revert_amount} EUR a la hucha '{principal_hucha_id}'...")
    
    # Transactional update
    @firestore.transactional
    def update_in_transaction(transaction, hucha_ref):
        snapshot = hucha_ref.get(transaction=transaction)
        current_balance = snapshot.to_dict().get('saldo_acumulado', 0)
        
        # Incrementar el saldo (devolver el dinero)
        new_balance = current_balance + revert_amount
        transaction.update(hucha_ref, {'saldo_acumulado': new_balance})
        
        # Borrar los movimientos
        for mid in ids_to_delete:
            mref = db.collection('movimientos').document(mid)
            transaction.delete(mref)
            
        return new_balance

    hucha_ref = db.collection('huchas').document(principal_hucha_id)
    transaction = db.transaction()
    final_balance = update_in_transaction(transaction, hucha_ref)
    
    print(f"OK: Movimientos borrados. Nuevo saldo en hucha 'Personal': {final_balance:.2f} EUR")

if __name__ == "__main__":
    revert_movements()
