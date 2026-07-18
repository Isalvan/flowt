# -*- coding: cp1252 -*-
import argparse
import os
import re
import sys
import unicodedata
from pathlib import Path

from dotenv import load_dotenv
from google.cloud import firestore

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

INTERNAL_EXACT_PREFIXES = (
    "prestamo a ",
    "subsanacion desde ",
    "reversion de prestamo",
    "reversion de subsanacion",
)

CASH_TERMS = ("retirada", "reintegro", "disposicion", "sacar dinero")
CASH_CONTEXT = ("cajero", "efectivo")


def normalize(value: str) -> str:
    no_accents = "".join(
        char for char in unicodedata.normalize("NFD", value or "")
        if unicodedata.category(char) != "Mn"
    )
    return re.sub(r"\s+", " ", no_accents.lower()).strip()


def is_internal(concept: str) -> bool:
    normalized = normalize(concept)
    if normalized.startswith(INTERNAL_EXACT_PREFIXES):
        return True
    # Algunos registros manuales históricos usan exactamente este concepto,
    # sin mencionar cajero ni efectivo.
    if normalized.startswith("sacar dinero"):
        return True
    return any(term in normalized for term in CASH_TERMS) and any(ctx in normalized for ctx in CASH_CONTEXT)


def recalculate_stats(movements):
    ingresos = 0.0
    gastos = 0.0
    for doc in movements:
        data = doc.to_dict() or {}
        internal = data.get("es_interno") is True or is_internal(data.get("concepto", ""))
        if internal:
            continue
        amount = float(data.get("importe") or 0)
        if data.get("tipo") == "ingreso":
            ingresos += amount
        elif data.get("tipo") == "gasto":
            gastos += amount
    return round(ingresos, 2), round(gastos, 2)


def main():
    parser = argparse.ArgumentParser(description="Marca movimientos internos historicos y recalcula stats externas.")
    parser.add_argument("--owner-id", default=os.getenv("UID_PROPIETARIO"), help="UID del propietario. Por defecto UID_PROPIETARIO del .env")
    parser.add_argument("--apply", action="store_true", help="Escribe cambios. Sin esto solo simula.")
    args = parser.parse_args()

    if not args.owner_id:
        print("Falta --owner-id o UID_PROPIETARIO en tracker-backend/.env", file=sys.stderr)
        return 2

    db = firestore.Client()
    query = db.collection("movimientos").where("id_propietario", "==", args.owner_id)
    docs = list(query.stream())
    to_mark = [doc for doc in docs if (doc.to_dict() or {}).get("es_interno") is not True and is_internal((doc.to_dict() or {}).get("concepto", ""))]
    ingresos, gastos = recalculate_stats(docs)

    print(f"Movimientos leidos: {len(docs)}")
    print(f"Movimientos internos a marcar: {len(to_mark)}")
    print(f"Stats externas recalculadas: ingresos={ingresos:.2f}, gastos={gastos:.2f}")

    if not args.apply:
        print("Simulacion completada. Ejecuta con --apply para escribir.")
        return 0

    batch = db.batch()
    writes = 0
    for doc in to_mark:
        batch.update(doc.reference, {"es_interno": True, "updated_at": firestore.SERVER_TIMESTAMP})
        writes += 1
        if writes % 450 == 0:
            batch.commit()
            batch = db.batch()
    if writes % 450:
        batch.commit()

    db.collection("stats").document(args.owner_id).set({
        "total_ingresos": ingresos,
        "total_gastos": gastos,
        "updated_at": firestore.SERVER_TIMESTAMP,
    }, merge=True)
    print("Migracion aplicada.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
