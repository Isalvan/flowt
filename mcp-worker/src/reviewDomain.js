/**
 * Pure review planning. All money deltas are integer cents; no writes occur here.
 *
 * Reassignment involving debt/subsanar arrangements or overflow without capacity is
 * rejected: these effects cannot safely be represented by balance deltas alone.
 * The caller must read every input in its transaction and persist the whole plan.
 */
import { fail } from './errors.js';
import { cents, localDate } from './financeDomain.js';
import { sha256Hex } from './util.js';

const PROPOSAL_FIELDS = ['name', 'category', 'subscription_id', 'new_subscription', 'reason', 'evidence', 'expected_version', 'configuration_revision', 'operation_id'];
const SUBSCRIPTION_FIELDS = ['name', 'amount', 'frequency', 'day', 'anchor_date', 'evidence_movement_ids', 'reason'];
const MONTHS_PER_YEAR = { mensual: 12, trimestral: 4, semestral: 2, anual: 1 };

function owned(owner, doc) {
  if (doc.id_propietario !== owner) fail('forbidden', 'El documento no pertenece al usuario');
}

function locked(movement, field) {
  const provenance = movement.field_provenance || {};
  if ((movement.review_protected_fields || []).includes(field) || provenance[field]?.source === 'manual') return true;
  // Historical confirmed categories must not silently become AI decisions.
  return field === 'categoria' && Boolean(movement.categoria) && !(field in provenance);
}

/** Calendar day in Europe/Madrid ('YYYY-MM-DD') of a stored or proposed date. */
function operationDate(value) {
  let day = null;
  if (value instanceof Date) day = localDate(value);
  else if (typeof value === 'string') {
    const zoned = /T.*(Z|[+-]\d{2}:\d{2})$/.test(value);
    day = zoned ? localDate(new Date(value)) : localDate(value);
  }
  if (!day) fail('invalid_date', 'Fecha de evidencia no válida');
  return day;
}

export function activeHucha(owner, huchaId, huchas) {
  const hucha = huchas[huchaId];
  if (!hucha) fail('invalid_hucha', 'La hucha configurada ya no existe');
  owned(owner, hucha);
  if (hucha.activa === false || hucha.es_metalico || hucha.es_interno) fail('invalid_hucha', 'La hucha no admite gastos externos');
  return hucha;
}

/** Balance deltas (cents) that move an expense to `target`, redirecting what a capped wallet cannot take back. */
export function reassignment(owner, movement, target, huchas) {
  const old = movement.hucha_id;
  if (old === target) return {};
  if (!old) fail('missing_original_hucha', 'No se puede revertir un cargo sin hucha original');
  const source = activeHucha(owner, old, huchas);
  activeHucha(owner, target, huchas);
  // Compensation links do not refund hucha balances in the current model.
  const amount = cents(movement.importe);
  if (amount < 0) fail('invalid_amount', 'Importe de gasto fuera de rango');
  const deltas = { [target]: -amount };

  const rejectDebt = (hucha) => {
    if (cents(hucha.deuda_pendiente || 0) !== 0 || hucha.deuda_con || hucha.subsanar_con) {
      fail('unsupported_debt', 'La reasignación con deuda requiere intervención manual');
    }
  };
  rejectDebt(source);
  rejectDebt(huchas[target]);

  const capacity = (id) => {
    const hucha = huchas[id];
    if (hucha.tope_objetivo && cents(hucha.objetivo || 0) > 0) {
      return Math.max(0, cents(hucha.objetivo) - cents(hucha.saldo_acumulado || 0) - (deltas[id] || 0));
    }
    return amount;
  };

  let accepted = Math.min(amount, capacity(old));
  deltas[old] = (deltas[old] || 0) + accepted;
  const overflow = amount - accepted;
  if (overflow) {
    const rank = (hucha) => (hucha.tipo_aportacion === 'resto' ? 0 : hucha.es_principal ? 1 : 2);
    const candidates = Object.entries(huchas)
      .filter(([, h]) => h.id_propietario === owner && h.activa !== false && !h.es_metalico && !h.es_interno)
      .sort(([a, x], [b, y]) => rank(x) - rank(y) || (x.orden || 0) - (y.orden || 0) || (a < b ? -1 : 1));
    if (!candidates.length) fail('unallocated_overflow', 'No existe destino para el desbordamiento');
    const [id, hucha] = candidates[0];
    rejectDebt(hucha);
    accepted = Math.min(overflow, capacity(id));
    deltas[id] = (deltas[id] || 0) + accepted;
    if (accepted !== overflow) fail('unallocated_overflow', 'Las huchas no tienen capacidad para conservar el saldo');
  }
  return Object.fromEntries(Object.entries(deltas).filter(([, delta]) => delta));
}

/**
 * Validate a review proposal against current data and return its full effect.
 * `movement` carries its id; `evidenceMovements` maps id → movement data.
 */
export async function planReview(ownerId, movement, proposal, categories, huchas, configuration, subscriptions, evidenceMovements) {
  owned(ownerId, movement);
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) || Object.keys(proposal).some((key) => !PROPOSAL_FIELDS.includes(key))) {
    fail('forbidden_fields', 'La propuesta contiene campos no admitidos');
  }
  if (proposal.expected_version !== (movement.review_version || 0)) fail('version_conflict', 'El movimiento cambió después de consultarlo');
  if (proposal.configuration_revision !== (configuration.revision || 0)) fail('configuration_conflict', 'La configuración cambió después de consultarla');
  if (typeof proposal.operation_id !== 'string' || !proposal.operation_id.trim()) fail('invalid_operation', 'Falta el identificador de operación');
  if (typeof proposal.reason !== 'string' || !proposal.reason.trim()) fail('missing_reason', 'La revisión necesita una explicación');
  if (movement.es_interno || movement.es_metalico) fail('ineligible_movement', 'La revisión solo admite movimientos externos');
  const changes = {};
  const links = {};
  const huchaChanges = {};
  const currency = movement.moneda || 'EUR';
  const mapping = configuration.category_huchas || {};
  const category = 'category' in proposal ? proposal.category : movement.categoria;
  if ('category' in proposal) {
    if (!categories.some((c) => c.id === category && [movement.tipo, 'ambos'].includes(c.tipo))) fail('invalid_category', 'Categoría no válida para este movimiento');
    if (category !== movement.categoria) {
      if (locked(movement, 'categoria')) fail('manual_field', 'La categoría está protegida por una decisión manual');
      changes.categoria = category;
    }
  }
  if ('name' in proposal) {
    const name = proposal.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 300) fail('invalid_name', 'Nombre no válido');
    if (name.trim() !== movement.concepto) {
      if (locked(movement, 'concepto')) fail('manual_field', 'El nombre está protegido');
      changes.concepto = name.trim();
    }
  }
  let newSubscription = null;
  let subscriptionId = 'subscription_id' in proposal ? proposal.subscription_id : movement.suscripcion_id;
  if ('new_subscription' in proposal && 'subscription_id' in proposal) fail('invalid_subscription', 'No se puede crear y vincular otra suscripción a la vez');
  if ('new_subscription' in proposal) {
    const sub = proposal.new_subscription;
    if (!sub || typeof sub !== 'object' || Array.isArray(sub) || Object.keys(sub).sort().join() !== [...SUBSCRIPTION_FIELDS].sort().join()) {
      fail('invalid_subscription', 'Contrato de suscripción incompleto o con campos extra');
    }
    if (!['monthly', 'mensual'].includes(sub.frequency)) fail('invalid_frequency', 'Solo se crean suscripciones mensuales automáticamente');
    const ids = sub.evidence_movement_ids;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && id) || new Set(ids).size !== ids.length || ids.length < 3) {
      fail('invalid_evidence', 'Se necesitan al menos tres movimientos distintos');
    }
    if (!ids.includes(movement.id)) fail('invalid_evidence', 'La evidencia debe incluir el movimiento revisado');
    if (currency !== 'EUR') fail('unsupported_currency', 'La creación automática solo admite EUR');
    if (typeof sub.name !== 'string' || !sub.name.trim() || sub.name.length > 100 || typeof sub.reason !== 'string' || !sub.reason.trim()) {
      fail('invalid_subscription', 'Faltan nombre o justificación de la suscripción');
    }
    if (!Number.isInteger(sub.day) || sub.day < 1 || sub.day > 31 || cents(sub.amount) <= 0) fail('invalid_subscription', 'Importe o día de suscripción no válido');
    const anchor = operationDate(sub.anchor_date);
    subscriptionId = `review-sub-${(await sha256Hex(`${ownerId}:${proposal.operation_id}`)).slice(0, 24)}`;
    if (subscriptions[subscriptionId]) fail('subscription_conflict', 'La suscripción ya existe');
    const months = new Set();
    for (const id of ids) {
      const evidence = evidenceMovements[id];
      if (!evidence) fail('invalid_evidence', 'Un movimiento de evidencia no existe');
      owned(ownerId, evidence);
      if (evidence.tipo !== 'gasto' || evidence.es_interno || evidence.es_metalico || cents(evidence.importe || 0) <= 0) {
        fail('invalid_evidence', 'La evidencia debe contener gastos externos');
      }
      if ((evidence.moneda || 'EUR') !== currency) fail('currency_conflict', 'Las monedas de la evidencia no coinciden');
      if (evidence.suscripcion_id || locked(evidence, 'suscripcion_id')) fail('subscription_conflict', 'Una evidencia ya está vinculada o protegida');
      const day = operationDate(evidence.fecha_operacion);
      months.add(Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)));
      links[id] = { suscripcion_id: subscriptionId };
    }
    if (![...months].some((month) => months.has(month + 1) && months.has(month + 2))) fail('insufficient_months', 'La evidencia no cubre tres meses consecutivos');
    newSubscription = { id: subscriptionId, id_propietario: ownerId, nombre: sub.name.trim(), importe: cents(sub.amount) / 100,
      frecuencia: 'mensual', dia_pago: sub.day, fecha_inicio: anchor, categoria: category || 'sin_categorizar', color: '#6366f1',
      activa: true, moneda: currency, review_version: 0 };
    const system = Object.keys(huchas).find((id) => huchas[id].id_propietario === ownerId && huchas[id].es_suscripciones && huchas[id].activa !== false) || null;
    const subscriptionHucha = mapping[category] || system || movement.hucha_id;
    if (subscriptionHucha) {
      activeHucha(ownerId, subscriptionHucha, huchas);
      newSubscription.hucha_id = subscriptionHucha;
    }
    if (system && subscriptionHucha === system) {
      // Twelfths of a year keep every cadence exact until the single final rounding.
      let twelfths = cents(newSubscription.importe) * 12;
      for (const existing of Object.values(subscriptions)) {
        owned(ownerId, existing);
        if (existing.activa === false || ![undefined, null, '', system].includes(existing.hucha_id)) continue;
        twelfths += cents(Number(existing.mi_parte ?? existing.importe ?? 0)) * (MONTHS_PER_YEAR[existing.frecuencia] || 12);
      }
      const rounded = Math.floor((2 * twelfths + 12) / 24) / 100;
      huchaChanges[system] = { objetivo: rounded || null, valor_aportacion: rounded, tipo_aportacion: 'flat', tope_objetivo: false };
    }
  } else if (subscriptionId) {
    const sub = subscriptions[subscriptionId];
    if (!sub) fail('invalid_subscription', 'La suscripción no existe');
    owned(ownerId, sub);
    if (sub.activa === false || (sub.moneda || 'EUR') !== currency) fail('invalid_subscription', 'La suscripción está inactiva o usa otra moneda');
  }
  if ('subscription_id' in proposal && !subscriptionId) fail('invalid_subscription', 'No se admite retirar vínculos mediante la revisión');
  if ((subscriptionId ?? null) !== (movement.suscripcion_id ?? null)) {
    if (movement.tipo !== 'gasto' || locked(movement, 'suscripcion_id')) fail('manual_field', 'Este movimiento no admite cambiar la suscripción');
    if (movement.suscripcion_id) fail('subscription_conflict', 'El movimiento ya está vinculado a otra suscripción');
    changes.suscripcion_id = subscriptionId;
  }
  let target = movement.hucha_id;
  if (movement.tipo === 'gasto' && !locked(movement, 'hucha_id')) {
    const mapped = mapping[category];
    const subscriptionHucha = (newSubscription || subscriptions[subscriptionId] || {}).hucha_id;
    target = mapped || subscriptionHucha || target;
    if (mapped || subscriptionHucha) activeHucha(ownerId, target, huchas);
  }
  let deltas = {};
  if ((target ?? null) !== (movement.hucha_id ?? null)) {
    deltas = reassignment(ownerId, movement, target, huchas);
    changes.hucha_id = target;
  }
  return { movement_changes: changes, hucha_deltas: deltas, hucha_changes: huchaChanges, new_subscription: newSubscription,
    subscription_changes: links, explanation: proposal.reason.trim(), evidence: proposal.evidence || [] };
}
