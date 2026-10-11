"""Pure review planning. All money deltas are integer cents; no writes occur here.

Reassignment involving debt/subsanar arrangements or overflow without capacity is
rejected: these effects cannot safely be represented by balance deltas alone.
The caller must read every input in its transaction and persist the whole plan.
"""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from hashlib import sha256
from zoneinfo import ZoneInfo


class ReviewError(ValueError):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def fail(code, message):
    raise ReviewError(code, message)


def cents(value):
    try:
        number = Decimal(str(value))
        if not number.is_finite():
            raise InvalidOperation
        return int((number * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError, TypeError):
        fail('invalid_amount', 'Importe no válido')


def owned(owner, doc):
    if doc.get('id_propietario') != owner:
        fail('forbidden', 'El documento no pertenece al usuario')


def locked(movement, field):
    provenance = movement.get('field_provenance', {})
    entry = provenance.get(field, {})
    if field in movement.get('review_protected_fields', []) or entry.get('source') == 'manual':
        return True
    # Historical confirmed categories must not silently become AI decisions.
    return field == 'categoria' and bool(movement.get('categoria')) and field not in provenance


def operation_date(value):
    try:
        if isinstance(value, datetime):
            dt = value
        elif isinstance(value, date):
            return value
        elif isinstance(value, str):
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        else:
            fail('invalid_date', 'Fecha de evidencia no válida')
        if dt.tzinfo is not None:
            dt = dt.astimezone(ZoneInfo('Europe/Madrid'))
        return dt.date()
    except (ValueError, TypeError):
        fail('invalid_date', 'Fecha de evidencia no válida')


def active_hucha(owner, hid, huchas):
    hucha = huchas.get(hid)
    if not hucha:
        fail('invalid_hucha', 'La hucha configurada ya no existe')
    owned(owner, hucha)
    if hucha.get('activa') is False or hucha.get('es_metalico') or hucha.get('es_interno'):
        fail('invalid_hucha', 'La hucha no admite gastos externos')
    return hucha


def reassignment(owner, movement, target, huchas):
    old = movement.get('hucha_id')
    if old == target:
        return {}
    if not old:
        fail('missing_original_hucha', 'No se puede revertir un cargo sin hucha original')
    source = active_hucha(owner, old, huchas)
    active_hucha(owner, target, huchas)
    # Compensation links do not refund hucha balances in the current model.
    amount = cents(movement['importe'])
    if amount < 0:
        fail('invalid_amount', 'Importe de gasto fuera de rango')
    deltas = {target: -amount}

    def reject_debt(hucha):
        if cents(hucha.get('deuda_pendiente', 0) or 0) != 0 or hucha.get('deuda_con') or hucha.get('subsanar_con'):
            fail('unsupported_debt', 'La reasignación con deuda requiere intervención manual')

    reject_debt(source)
    reject_debt(huchas[target])

    def capacity(hid):
        h = huchas[hid]
        if h.get('tope_objetivo') and cents(h.get('objetivo') or 0) > 0:
            return max(0, cents(h['objetivo']) - cents(h.get('saldo_acumulado', 0)) - deltas.get(hid, 0))
        return amount

    accepted = min(amount, capacity(old))
    deltas[old] = deltas.get(old, 0) + accepted
    overflow = amount - accepted
    if overflow:
        candidates = [(hid, h) for hid, h in huchas.items() if h.get('id_propietario') == owner and h.get('activa') is not False and not h.get('es_metalico') and not h.get('es_interno')]
        candidates.sort(key=lambda item: (0 if item[1].get('tipo_aportacion') == 'resto' else 1 if item[1].get('es_principal') else 2, item[1].get('orden', 0), item[0]))
        if not candidates:
            fail('unallocated_overflow', 'No existe destino para el desbordamiento')
        hid, hucha = candidates[0]
        reject_debt(hucha)
        accepted = min(overflow, capacity(hid))
        deltas[hid] = deltas.get(hid, 0) + accepted
        if accepted != overflow:
            fail('unallocated_overflow', 'Las huchas no tienen capacidad para conservar el saldo')
    deltas = {hid: delta for hid, delta in deltas.items() if delta}
    assert sum(deltas.values()) == 0
    return deltas


def plan_review(owner_id, movement, proposal, categories, huchas, configuration, subscriptions, evidence_movements):
    owned(owner_id, movement)
    allowed = {'name', 'category', 'subscription_id', 'new_subscription', 'reason', 'evidence', 'expected_version', 'configuration_revision', 'operation_id'}
    if not isinstance(proposal, dict) or set(proposal) - allowed:
        fail('forbidden_fields', 'La propuesta contiene campos no admitidos')
    if proposal.get('expected_version') != movement.get('review_version', 0):
        fail('version_conflict', 'El movimiento cambió después de consultarlo')
    if proposal.get('configuration_revision') != configuration.get('revision', 0):
        fail('configuration_conflict', 'La configuración cambió después de consultarla')
    if not isinstance(proposal.get('operation_id'), str) or not proposal['operation_id'].strip():
        fail('invalid_operation', 'Falta el identificador de operación')
    if not isinstance(proposal.get('reason'), str) or not proposal['reason'].strip():
        fail('missing_reason', 'La revisión necesita una explicación')
    if movement.get('es_interno') or movement.get('es_metalico'):
        fail('ineligible_movement', 'La revisión solo admite movimientos externos')
    changes, links, hucha_changes = {}, {}, {}
    category = proposal.get('category', movement.get('categoria'))
    if 'category' in proposal:
        if not any(c['id'] == category and c.get('tipo') in (movement['tipo'], 'ambos') for c in categories):
            fail('invalid_category', 'Categoría no válida para este movimiento')
        if category != movement.get('categoria'):
            if locked(movement, 'categoria'):
                fail('manual_field', 'La categoría está protegida por una decisión manual')
            changes['categoria'] = category
    if 'name' in proposal:
        name = proposal['name']
        if not isinstance(name, str) or not name.strip() or len(name) > 300:
            fail('invalid_name', 'Nombre no válido')
        if name.strip() != movement.get('concepto'):
            if locked(movement, 'concepto'):
                fail('manual_field', 'El nombre está protegido')
            changes['concepto'] = name.strip()
    new_sub = None
    sid = proposal.get('subscription_id', movement.get('suscripcion_id'))
    if 'new_subscription' in proposal and 'subscription_id' in proposal:
        fail('invalid_subscription', 'No se puede crear y vincular otra suscripción a la vez')
    if 'new_subscription' in proposal:
        sub = proposal['new_subscription']
        fields = {'name', 'amount', 'frequency', 'day', 'anchor_date', 'evidence_movement_ids', 'reason'}
        if not isinstance(sub, dict) or set(sub) != fields:
            fail('invalid_subscription', 'Contrato de suscripción incompleto o con campos extra')
        if sub['frequency'] not in ('monthly', 'mensual'):
            fail('invalid_frequency', 'Solo se crean suscripciones mensuales automáticamente')
        ids = sub['evidence_movement_ids']
        if not isinstance(ids, list) or not all(isinstance(i, str) and i for i in ids) or len(set(ids)) != len(ids) or len(ids) < 3:
            fail('invalid_evidence', 'Se necesitan al menos tres movimientos distintos')
        if movement.get('id') not in ids:
            fail('invalid_evidence', 'La evidencia debe incluir el movimiento revisado')
        if movement.get('moneda', 'EUR') != 'EUR':
            fail('unsupported_currency', 'La creación automática solo admite EUR')
        if not isinstance(sub['name'], str) or not sub['name'].strip() or len(sub['name']) > 100 or not isinstance(sub['reason'], str) or not sub['reason'].strip():
            fail('invalid_subscription', 'Faltan nombre o justificación de la suscripción')
        if isinstance(sub['day'], bool) or not isinstance(sub['day'], int) or not 1 <= sub['day'] <= 31 or cents(sub['amount']) <= 0:
            fail('invalid_subscription', 'Importe o día de suscripción no válido')
        anchor = operation_date(sub['anchor_date']).isoformat()
        sid = 'review-sub-' + sha256((owner_id + ':' + proposal['operation_id']).encode()).hexdigest()[:24]
        if sid in subscriptions:
            fail('subscription_conflict', 'La suscripción ya existe')
        months = set()
        for mid in ids:
            evidence = evidence_movements.get(mid)
            if not evidence:
                fail('invalid_evidence', 'Un movimiento de evidencia no existe')
            owned(owner_id, evidence)
            if evidence.get('tipo') != 'gasto' or evidence.get('es_interno') or evidence.get('es_metalico') or cents(evidence.get('importe', 0)) <= 0:
                fail('invalid_evidence', 'La evidencia debe contener gastos externos')
            if evidence.get('moneda', 'EUR') != movement.get('moneda', 'EUR'):
                fail('currency_conflict', 'Las monedas de la evidencia no coinciden')
            if evidence.get('suscripcion_id') or locked(evidence, 'suscripcion_id'):
                fail('subscription_conflict', 'Una evidencia ya está vinculada o protegida')
            dt = operation_date(evidence.get('fecha_operacion'))
            months.add(dt.year * 12 + dt.month)
            links[mid] = {'suscripcion_id': sid}
        if not any(month + 1 in months and month + 2 in months for month in months):
            fail('insufficient_months', 'La evidencia no cubre tres meses consecutivos')
        new_sub = {'id': sid, 'id_propietario': owner_id, 'nombre': sub['name'].strip(), 'importe': cents(sub['amount']) / 100, 'frecuencia': 'mensual', 'dia_pago': sub['day'], 'fecha_inicio': anchor, 'categoria': category or 'sin_categorizar', 'color': '#6366f1', 'activa': True, 'moneda': movement.get('moneda', 'EUR'), 'review_version': 0}
        system = next((hid for hid, h in huchas.items() if h.get('id_propietario') == owner_id and h.get('es_suscripciones') and h.get('activa') is not False), None)
        sub_hucha = configuration.get('category_huchas', {}).get(category) or system or movement.get('hucha_id')
        if sub_hucha:
            active_hucha(owner_id, sub_hucha, huchas)
            new_sub['hucha_id'] = sub_hucha
        if system and sub_hucha == system:
            total = Decimal(str(new_sub['importe']))
            divisors = {'mensual': 1, 'trimestral': 3, 'semestral': 6, 'anual': 12}
            for existing in subscriptions.values():
                owned(owner_id, existing)
                if existing.get('activa') is False or existing.get('hucha_id') not in (None, '', system):
                    continue
                amount = existing.get('mi_parte') if existing.get('mi_parte') is not None else existing.get('importe', 0)
                total += Decimal(cents(amount)) / 100 / divisors.get(existing.get('frecuencia'), 1)
            rounded = cents(total) / 100
            hucha_changes[system] = {'objetivo': rounded or None, 'valor_aportacion': rounded, 'tipo_aportacion': 'flat', 'tope_objetivo': False}
    elif sid:
        sub = subscriptions.get(sid)
        if not sub:
            fail('invalid_subscription', 'La suscripción no existe')
        owned(owner_id, sub)
        if sub.get('activa') is False or sub.get('moneda', 'EUR') != movement.get('moneda', 'EUR'):
            fail('invalid_subscription', 'La suscripción está inactiva o usa otra moneda')
    if 'subscription_id' in proposal and not sid:
        fail('invalid_subscription', 'No se admite retirar vínculos mediante la revisión')
    if sid != movement.get('suscripcion_id'):
        if movement['tipo'] != 'gasto' or locked(movement, 'suscripcion_id'):
            fail('manual_field', 'Este movimiento no admite cambiar la suscripción')
        if movement.get('suscripcion_id'):
            fail('subscription_conflict', 'El movimiento ya está vinculado a otra suscripción')
        changes['suscripcion_id'] = sid
    target = movement.get('hucha_id')
    if movement['tipo'] == 'gasto' and not locked(movement, 'hucha_id'):
        mapped = configuration.get('category_huchas', {}).get(category)
        subscription_hucha = (new_sub or subscriptions.get(sid, {})).get('hucha_id')
        target = mapped or subscription_hucha or target
        if mapped or subscription_hucha:
            active_hucha(owner_id, target, huchas)
    deltas = {}
    if target != movement.get('hucha_id'):
        deltas = reassignment(owner_id, movement, target, huchas)
        changes['hucha_id'] = target
    return {'movement_changes': changes, 'hucha_deltas': deltas, 'hucha_changes': hucha_changes, 'new_subscription': new_sub, 'subscription_changes': links, 'explanation': proposal['reason'].strip(), 'evidence': proposal.get('evidence', [])}
