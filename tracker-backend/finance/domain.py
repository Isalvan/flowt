"""Pure wallet arithmetic for the finance tools. All money is integer cents.

Nothing here reads or writes Firestore: callers read every input inside their
transaction and persist the returned plan as a whole.
"""
import re
import unicodedata
from calendar import monthrange
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from zoneinfo import ZoneInfo

from reviews.domain import cents, fail

MADRID = ZoneInfo("Europe/Madrid")
FREQUENCY_MONTHS = {"mensual": 1, "trimestral": 3, "semestral": 6, "anual": 12}
SUBSCRIPTION_CATEGORIES = ["streaming", "musica", "software", "gaming", "fitness", "noticias", "otros"]
SUBSCRIPTION_COLORS = ["#8b5cf6", "#ec4899", "#3b82f6", "#0ea5e9", "#14b8a6",
                       "#22c55e", "#f59e0b", "#f97316", "#ef4444", "#6366f1"]
MAX_AMOUNT = 100_000_000  # 1 000 000,00 €


def euros(value):
    return value / 100


def amount_cents(value, allow_zero=False):
    if isinstance(value, bool):
        fail("invalid_amount", "Importe no válido")
    number = cents(value)
    if number < 0 or number > MAX_AMOUNT or (number == 0 and not allow_zero):
        fail("invalid_amount", "El importe debe ser positivo y razonable")
    return number


def clean_text(value, limit, code="invalid_text", message="Texto no válido"):
    """Mirror of the web's sanitizeConcepto: drop control characters, trim, cap."""
    if not isinstance(value, str):
        fail(code, message)
    text = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", value).strip()[:limit]
    if not text:
        fail(code, message)
    return text


def parse_moment(value):
    """ISO datetime, or a plain date stored as UTC midnight like the web does."""
    try:
        if not isinstance(value, str):
            raise ValueError
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    except ValueError:
        fail("invalid_date", "Usa una fecha AAAA-MM-DD o una fecha y hora ISO")


def local_date(value):
    if isinstance(value, datetime):
        return (value.astimezone(MADRID) if value.tzinfo else value).date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


# --- Wallets ---------------------------------------------------------------

def is_active(hucha):
    return hucha.get("activa") is not False


def ordered(huchas):
    """Active wallets as (id, data), in the user's display order."""
    return sorted(((hid, h) for hid, h in huchas.items() if is_active(h)),
                  key=lambda item: (item[1].get("orden") or 0, item[0]))


def fallback_hucha(huchas, exclude=()):
    """Where unassigned money lands: the 'resto' wallet, else the main one."""
    wallets = [(hid, h) for hid, h in ordered(huchas) if hid not in exclude and not h.get("es_metalico")]
    for wanted in (lambda h: h.get("tipo_aportacion") == "resto", lambda h: h.get("es_principal"), lambda h: True):
        for hid, hucha in wallets:
            if wanted(hucha):
                return hid
    return None


def expense_hucha(huchas):
    """Default wallet for an expense with no explicit wallet: main, then 'resto'."""
    wallets = [(hid, h) for hid, h in ordered(huchas) if not h.get("es_metalico")]
    for wanted in (lambda h: h.get("es_principal"), lambda h: h.get("tipo_aportacion") == "resto", lambda h: True):
        for hid, hucha in wallets:
            if wanted(hucha):
                return hid
    return None


def room(hucha, pending=0):
    """Capacity left under a capped goal, in cents; None when the wallet is uncapped."""
    goal = cents(hucha.get("objetivo") or 0)
    if hucha.get("tope_objetivo") and goal > 0:
        return max(0, goal - cents(hucha.get("saldo_acumulado") or 0) - pending)
    return None


def percentage_total(huchas, replacing=None):
    """Sum of percentage allocations across active wallets; `replacing` overrides one."""
    total = Decimal(0)
    for hid, hucha in ordered({**huchas, **(replacing or {})}):
        if hucha.get("tipo_aportacion") == "porcentaje":
            total += Decimal(str(hucha.get("valor_aportacion") or 0))
    return total


def is_payroll(movement):
    category = movement.get("categoria") or movement.get("categoria_sugerida")
    if category:
        return category == "nomina"
    concept = name_key(movement.get("concepto") or "")
    return bool(re.search(r"(?<![a-z0-9_])(?:nomina|salario|sueldo)(?![a-z0-9_])", concept))


def extra_month(movement):
    if not is_payroll(movement):
        return None
    value = movement.get("fecha_operacion")
    try:
        if isinstance(value, str):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?", value):
                return None
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if isinstance(value, datetime):
            value = (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).astimezone(MADRID)
        elif not isinstance(value, date):
            return None
        return value.strftime("%Y-%m")
    except (ValueError, OverflowError):
        return None


def distribute_income(amount, huchas, plain=False, extra_month=None):
    """Split an income: fixed amounts, payroll extras, percentages, then the rest.

    Capped wallets only take what fits and a wallet in debt repays its lender
    first, as the email synchroniser does. `plain` skips caps and debts: it is
    the web's simpler split, used to undo incomes that carry no recorded split.
    Returns {"saldos": {hucha: cents}, "deudas": {hucha: {"importe", "con"}}}.
    """
    wallets = [(hid, h) for hid, h in ordered(huchas) if not h.get("es_metalico")]
    if not wallets:
        fail("no_hucha", "No hay ninguna cartera activa para repartir el ingreso")
    if not plain and percentage_total(huchas) > 100:
        fail("invalid_distribution", "Los porcentajes de las carteras superan el 100 %; corrígelos antes")
    saldos, deudas, extras = {}, {}, {}
    remaining = amount

    def credit(hid, hucha, value):
        lender = hucha.get("deuda_con")
        debt = cents(hucha.get("deuda_pendiente") or 0) - deudas.get(hid, {}).get("importe", 0)
        if not plain and debt > 0 and lender and lender != hid and lender in huchas and is_active(huchas[lender]):
            payment = min(debt, value)
            deudas[hid] = {"importe": deudas.get(hid, {}).get("importe", 0) + payment, "con": lender}
            saldos[lender] = saldos.get(lender, 0) + payment
            value -= payment
        if value:
            saldos[hid] = saldos.get(hid, 0) + value

    for kind in ("flat", "extra", "porcentaje"):
        for hid, hucha in wallets:
            if remaining <= 0:
                continue
            if kind == "extra":
                if (plain or not extra_month or (hucha.get("extra_importe") or 0) <= 0
                        or int(extra_month[5:7]) not in (hucha.get("extra_meses") or [])
                        or hucha.get("extra_ultimo") == extra_month):
                    continue
            elif hucha.get("tipo_aportacion") != kind:
                continue
            rule = Decimal(str(hucha.get("extra_importe" if kind == "extra" else "valor_aportacion") or 0))
            planned = cents(rule) if kind != "porcentaje" else int((amount * rule / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            free = None if plain or (kind == "flat" and hucha.get("es_suscripciones")) else room(hucha, saldos.get(hid, 0))
            if free is not None:
                planned = min(planned, free)
            share = min(max(planned, 0), remaining)
            if share:
                remaining -= share
                credit(hid, hucha, share)
                if kind == "extra":
                    extras[hid] = extra_month
    if remaining:
        target = fallback_hucha(huchas)
        credit(target, huchas[target], remaining)
    assert sum(saldos.values()) == amount
    return {"saldos": saldos, "deudas": deudas, **({"extras": extras} if extras else {})}


def income_reversal(movement, huchas):
    """Effects that undo an auto-distributed income.

    Uses the split recorded when the income was created; older incomes carry
    none, so the split is recomputed from today's rules as the web does.
    Shares of wallets that no longer exist or are archived fall on the rest wallet.
    """
    amount = cents(movement["importe"])
    recorded = movement.get("reparto_aplicado")
    if isinstance(recorded, dict) and recorded.get("saldos"):
        saldos = {hid: cents(value) for hid, value in recorded["saldos"].items()}
        deudas = {hid: {"importe": cents(d.get("importe", 0)), "con": d.get("con")}
                  for hid, d in (recorded.get("deudas") or {}).items()}
    else:
        split = distribute_income(amount, huchas, plain=True)
        saldos, deudas = split["saldos"], {}
    result = {}
    for hid, value in saldos.items():
        target = hid if hid in huchas and is_active(huchas[hid]) else fallback_hucha(huchas)
        if target is None:
            fail("no_hucha", "No hay ninguna cartera activa para revertir el ingreso")
        result[target] = result.get(target, 0) - value
    restored = {hid: d for hid, d in deudas.items() if hid in huchas and is_active(huchas[hid]) and d["importe"]}
    return {"saldos": result, "deudas": restored, **({"extras": dict(recorded["extras"])} if isinstance(recorded, dict) and recorded.get("extras") else {})}


def recorded_split(split):
    """Shape stored on the movement so the income can be undone exactly."""
    return {"saldos": {hid: euros(v) for hid, v in split["saldos"].items()},
            "deudas": {hid: {"importe": euros(d["importe"]), "con": d["con"]} for hid, d in split["deudas"].items()},
            **({"extras": dict(split["extras"])} if split.get("extras") else {})}


def counts_in_stats(movement):
    return not movement.get("es_interno") and not movement.get("transfer_id")


# --- Compensations (a refund that offsets an expense) ----------------------

def available(movement):
    """Cents of a movement not yet consumed by compensations."""
    amount = cents(movement.get("importe") or 0)
    if amount < 0:
        return 0
    if movement.get("tipo") == "gasto":
        if movement.get("importe_neto") is not None:
            return max(0, cents(movement["importe_neto"]))
        return max(0, amount - sum(cents(d["importe"]) for d in movement.get("compensado_por_detalles") or []))
    if movement.get("compensa_movimiento_id"):
        return 0  # Legacy links already consumed the whole income.
    return max(0, amount - sum(cents(d["importe"]) for d in movement.get("compensaciones_destinos") or []))


def compensation_updates(base, allocations):
    """Port of the web's compensationUpdates. `allocations` is [(movement, cents)]."""
    if not allocations or base.get("es_interno") or base.get("transfer_id"):
        fail("invalid_compensation", "Selecciona movimientos externos para compensar")
    seen, total = set(), 0
    for movement, amount in allocations:
        if (movement["id"] in seen or movement["id"] == base["id"] or movement.get("tipo") == base.get("tipo")
                or movement.get("es_interno") or movement.get("transfer_id")):
            fail("invalid_compensation", "La compensación necesita un gasto y un ingreso distintos")
        seen.add(movement["id"])
        if amount <= 0 or amount > available(movement):
            fail("invalid_compensation", "El importe supera el saldo disponible o no es válido")
        total += amount
    if total > available(base):
        fail("invalid_compensation", "El importe supera el saldo disponible del movimiento")
    current = {base["id"]: dict(base), **{m["id"]: dict(m) for m, _ in allocations}}
    updates = {}
    for movement, amount in allocations:
        gasto = current[base["id"] if base["tipo"] == "gasto" else movement["id"]]
        ingreso = current[base["id"] if base["tipo"] == "ingreso" else movement["id"]]
        detalles = [d for d in gasto.get("compensado_por_detalles") or [] if d["ingreso_id"] != ingreso["id"]]
        previous = next((cents(d["importe"]) for d in gasto.get("compensado_por_detalles") or [] if d["ingreso_id"] == ingreso["id"]), 0)
        detalles.append({"ingreso_id": ingreso["id"], "importe": euros(previous + amount)})
        destinos = [d for d in ingreso.get("compensaciones_destinos") or [] if d["gasto_id"] != gasto["id"]]
        previous = next((cents(d["importe"]) for d in ingreso.get("compensaciones_destinos") or [] if d["gasto_id"] == gasto["id"]), 0)
        destinos.append({"gasto_id": gasto["id"], "importe": euros(previous + amount)})
        gasto_update = {"compensado_por_detalles": detalles, "importe_neto": euros(available(gasto) - amount)}
        ingreso_update = {"compensaciones_destinos": destinos}
        gasto.update(gasto_update)
        ingreso.update(ingreso_update)
        updates[gasto["id"]] = {**updates.get(gasto["id"], {}), **gasto_update}
        updates[ingreso["id"]] = {**updates.get(ingreso["id"], {}), **ingreso_update}
    return updates


def linked_ids(movement):
    if movement.get("tipo") == "gasto":
        ids = list(movement.get("compensado_por") or []) + [d["ingreso_id"] for d in movement.get("compensado_por_detalles") or []]
    else:
        ids = ([movement["compensa_movimiento_id"]] if movement.get("compensa_movimiento_id") else []) + \
              [d["gasto_id"] for d in movement.get("compensaciones_destinos") or []]
    return list(dict.fromkeys(ids))


def unlink_updates(base, related):
    """Port of the web's unlinkCompensationUpdates. A None value means 'delete the field'."""
    updates = {}
    current = dict(base)
    for target in related:
        if target.get("tipo") == base.get("tipo"):
            continue
        gasto, ingreso = (current, target) if base["tipo"] == "gasto" else (target, current)
        detalle = next((d for d in gasto.get("compensado_por_detalles") or [] if d["ingreso_id"] == ingreso["id"]), None)
        destino = next((d for d in ingreso.get("compensaciones_destinos") or [] if d["gasto_id"] == gasto["id"]), None)
        legacy = ingreso["id"] in (gasto.get("compensado_por") or []) or ingreso.get("compensa_movimiento_id") == gasto["id"]
        if not detalle and not destino and not legacy:
            continue
        amount = cents((detalle or destino or {"importe": ingreso["importe"]})["importe"])
        detalles = [d for d in gasto.get("compensado_por_detalles") or [] if d["ingreso_id"] != ingreso["id"]]
        legacy_ids = [i for i in gasto.get("compensado_por") or [] if i != ingreso["id"]]
        destinos = [d for d in ingreso.get("compensaciones_destinos") or [] if d["gasto_id"] != gasto["id"]]
        still_linked = bool(detalles or legacy_ids)
        gasto_update = {
            "compensado_por_detalles": detalles or None,
            "compensado_por": legacy_ids or None,
            "importe_neto": euros(min(cents(gasto["importe"]), available(gasto) + amount)) if still_linked else None,
        }
        ingreso_update = {
            "compensaciones_destinos": destinos or None,
            "compensa_movimiento_id": None if ingreso.get("compensa_movimiento_id") == gasto["id"] else ingreso.get("compensa_movimiento_id"),
        }
        updates[gasto["id"]] = {**updates.get(gasto["id"], {}), **gasto_update}
        updates[ingreso["id"]] = {**updates.get(ingreso["id"], {}), **ingreso_update}
        current = {**current, **(gasto_update if base["tipo"] == "gasto" else ingreso_update)}
    return updates


# --- Subscriptions ---------------------------------------------------------

def monthly_amount(subscription):
    """Monthly cost of a subscription in euros (the user's share when it is shared)."""
    share = subscription.get("mi_parte")
    effective = Decimal(str(share if share is not None else subscription.get("importe") or 0))
    return effective / FREQUENCY_MONTHS.get(subscription.get("frecuencia"), 1)


def subscriptions_target(subscriptions, system_id):
    """Monthly target of the automatic 'Suscripciones' wallet, in euros."""
    total = sum((monthly_amount(s) for s in subscriptions
                 if s.get("activa") and (not s.get("hucha_id") or s.get("hucha_id") == system_id)), Decimal(0))
    return float(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def clamp_day(year, month, day):
    return date(year, month, min(max(int(day or 1), 1), monthrange(year, month)[1]))


def anchor_date(subscription, fallback):
    explicit = local_date(subscription.get("fecha_inicio"))
    if explicit:
        return explicit
    created = local_date(subscription.get("created_at")) or fallback
    return clamp_day(created.year, created.month, subscription.get("dia_pago") or created.day)


def next_charge(subscription, start, include_today=True):
    """Next billing date on or after `start`, following the anchor and cadence."""
    anchor = anchor_date(subscription, start)
    cadence = FREQUENCY_MONTHS.get(subscription.get("frecuencia"), 1)
    for offset in range(121):
        year, month = divmod(start.year * 12 + start.month - 1 + offset, 12)
        distance = (year - anchor.year) * 12 + month + 1 - anchor.month
        if distance < 0 or distance % cadence:
            continue
        charge = clamp_day(year, month + 1, subscription.get("dia_pago") or anchor.day)
        if charge > start or (include_today and charge == start):
            return charge
    return clamp_day(start.year + 10, start.month, subscription.get("dia_pago") or anchor.day)


# --- Categories ------------------------------------------------------------

def name_key(label):
    normalized = unicodedata.normalize("NFD", label)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch)).lower()


def custom_category_id(label, tipo):
    return "custom_" + sha256(f"{name_key(label)}:{tipo}".encode()).hexdigest()
