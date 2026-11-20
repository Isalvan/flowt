import type { Movimiento } from '../types';
import { parseMovimientoDate } from './periodStats';
import { isPayrollConcept } from './movementSuggestions';
import { paidTicketPeople } from './ticketPayments';
import { normalizeTicketText, ticketDay } from './ticketSplit';

/**
 * «Banco de amigos»: lo que te mueves con cada persona por Bizum.
 *
 * Qué traen los datos (avisos de Unicaja):
 * - Un ingreso recibido dice «en concepto de <nombre completo del ordenante>», sin
 *   distinguir Bizum de transferencia. Es la única fuente fiable del nombre.
 * - Un Bizum enviado dice «bizum:<lo que escribiste>», sin destinatario, y el
 *   extractor solo guarda los que tienen motivo de gasto. Solo se atribuye a alguien
 *   si ese texto nombra a una persona.
 * - Lo que te deben sale de los tickets repartidos que nadie ha pagado todavía.
 */

export interface FriendDebt {
  gastoId: string;
  comercio: string;
  importe: number;
  fecha: Date | null;
}

export interface FriendEntry {
  /** Nombre normalizado; dos personas con el mismo nombre de pila no se mezclan. */
  clave: string;
  nombre: string;
  recibido: number;
  enviado: number;
  vecesRecibido: number;
  vecesEnviado: number;
  /** Partes de tickets repartidos que aún no te ha devuelto. */
  teDebe: number;
  pendientes: FriendDebt[];
  /** Lo que adelantaste por esta persona y luego te devolvió (compensaciones). */
  adelantado: number;
  /** Mediana de días entre tu pago y su devolución. */
  diasDevolucion: number | null;
  ultimo: Date | null;
}

export interface FriendsBank {
  personas: FriendEntry[];
  totalTeDeben: number;
  totalRecibido: number;
  totalEnviado: number;
  totalAdelantado: number;
  /** Bizum enviados que no dicen a quién. */
  enviadosSinNombre: number;
}

const PREFIX = new Set(['bizum', 'transferencia', 'transf', 'trf', 'ingreso', 'abono', 'recibido', 'recibida', 'enviado', 'enviada', 'de', 'del', 'desde', 'a', 'para']);
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'i', 'da', 'dos', 'van', 'von']);
// Palabras que delatan un comercio, un organismo o un motivo, no a una persona.
const NOT_A_NAME = new Set([
  'sl', 'sa', 'slu', 'sll', 'cb', 'sociedad', 'limitada', 'anonima', 'coop', 'cooperativa', 'asociacion', 'fundacion', 'club',
  'banco', 'unicaja', 'bbva', 'santander', 'caixabank', 'sabadell', 'bankinter', 'ing', 'revolut', 'n26', 'openbank', 'abanca', 'kutxabank',
  'hacienda', 'agencia', 'tributaria', 'aeat', 'seguridad', 'social', 'ayuntamiento', 'gobierno', 'junta', 'generalitat', 'ministerio', 'sepe', 'tesoreria',
  'seguro', 'seguros', 'mutua', 'servicios', 'grupo', 'tienda', 'store', 'shop', 'online', 'ltd', 'inc', 'gmbh', 'bv', 'llc', 'corp',
  'amazon', 'paypal', 'google', 'apple', 'wallapop', 'vinted', 'spotify', 'netflix', 'stripe', 'adyen', 'glovo', 'uber', 'cabify', 'airbnb', 'booking',
  'nomina', 'salario', 'sueldo', 'paga', 'intereses', 'dividendos', 'cashback', 'bonificacion', 'promocion', 'premio', 'loteria', 'regalo', 'cumple', 'cumpleanos',
  'reembolso', 'devolucion', 'devol', 'compensacion', 'pago', 'cuota', 'recibo', 'factura', 'alquiler', 'piso', 'luz', 'agua', 'gas', 'internet', 'mes',
  'cena', 'comida', 'desayuno', 'copas', 'cafe', 'compra', 'compras', 'viaje', 'entrada', 'entradas', 'concierto', 'cine', 'gasolina', 'parking', 'taxi', 'bote',
  'parte', 'mi', 'tu', 'su', 'ayer', 'hoy', 'gracias', 'varios', 'otros', 'gastos', 'traspaso', 'ahorro', 'cuenta', 'tarjeta', 'efectivo', 'cajero',
]);

const round = (n: number) => Math.round(n * 100) / 100;

const nameTokens = (tokens: string[]) => tokens.filter(t => !PARTICLES.has(t));

/** Texto normalizado sin el «Bizum de…» del principio, y si lo llevaba. */
function stripPrefix(text: string): { tokens: string[]; bizum: boolean } {
  const tokens = normalizeTicketText(text).split(' ').filter(Boolean);
  let bizum = false;
  while (tokens.length && PREFIX.has(tokens[0])) {
    if (tokens[0] === 'bizum') bizum = true;
    tokens.shift();
  }
  return { tokens, bizum };
}

/**
 * Devuelve la clave de persona si el concepto tiene forma de nombre: de 2 a 5
 * palabras sin cifras ni términos de comercio. Un solo nombre de pila solo vale
 * detrás de «Bizum», donde no hay duda de que es alguien.
 */
export function personFromConcept(concepto: string): { clave: string; nombre: string } | null {
  const { tokens, bizum } = stripPrefix(concepto);
  if (!tokens.length || tokens.length > 7) return null;
  if (tokens.some(t => /\d/.test(t) || NOT_A_NAME.has(t) || t.length < 2 && !PARTICLES.has(t))) return null;
  const names = nameTokens(tokens);
  if (names.length < 1 || names.length > 5) return null;
  if (names.length === 1 && !(bizum && names[0].length >= 3)) return null;
  return { clave: names.join(' '), nombre: tokens.map((t, i) => PARTICLES.has(t) && i > 0 ? t : t[0].toUpperCase() + t.slice(1)).join(' ') };
}

const isBizumOut = (m: Movimiento) => m.tipo === 'gasto' &&
  /\bbizum\b/.test(normalizeTicketText(`${m.original_concept ?? ''} ${m.concepto}`));

const isPersonIncomeCandidate = (m: Movimiento) => m.tipo === 'ingreso' && !m.es_interno && !m.transfer_id &&
  !['nomina', 'intereses', 'trabajos'].includes(m.categoria ?? '') && !isPayrollConcept(m.concepto);

/**
 * Una persona conocida nombrada en el texto. Nombre y apellido bastan aunque haya
 * otras con el mismo nombre de pila; el nombre de pila solo, si nadie más lo comparte.
 */
function uniqueMatch(text: string, people: Iterable<{ clave: string }>): string | null {
  const words = new Set(stripPrefix(text).tokens);
  const named = [...people].filter(({ clave }) => words.has(clave.split(' ')[0]));
  const full = named.filter(({ clave }) => clave.split(' ').filter(p => words.has(p)).length >= 2);
  const hits = full.length ? full : named;
  return hits.length === 1 ? hits[0].clave : null;
}

/** La persona de las transferencias a la que se refiere un nombre de ticket («David», «David G»). */
function ticketOwner(ticketTokens: string[], people: { clave: string }[]): string | null {
  const hits = people.filter(({ clave }) => {
    const parts = clave.split(' ');
    return parts[0] === ticketTokens[0] && ticketTokens.every(t => parts.some(p => p === t || t.length === 1 && p.startsWith(t)));
  });
  return hits.length === 1 ? hits[0].clave : null;
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function buildFriendsBank(movimientos: readonly Movimiento[], now = new Date()): FriendsBank {
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const inWindow = movimientos.filter(m => {
    const date = parseMovimientoDate(m.fecha_operacion);
    return date && date >= since && date <= now;
  });
  const byId = new Map(movimientos.map(m => [m.id, m]));
  const people = new Map<string, FriendEntry & { dias: number[] }>();
  const entry = (clave: string, nombre: string) => {
    let person = people.get(clave);
    if (!person) {
      person = { clave, nombre, recibido: 0, enviado: 0, vecesRecibido: 0, vecesEnviado: 0, teDebe: 0, pendientes: [], adelantado: 0, diasDevolucion: null, ultimo: null, dias: [] };
      people.set(clave, person);
    }
    return person;
  };
  const touch = (person: FriendEntry, value: unknown) => {
    const date = parseMovimientoDate(value);
    if (date && (!person.ultimo || date > person.ultimo)) person.ultimo = date;
  };

  // 1. Ingresos de personas: el nombre del ordenante viene en el concepto.
  for (const m of inWindow) {
    if (!isPersonIncomeCandidate(m)) continue;
    const who = personFromConcept(m.original_concept ?? m.concepto) ?? personFromConcept(m.concepto);
    if (!who) continue;
    const person = entry(who.clave, who.nombre);
    person.recibido += m.importe;
    person.vecesRecibido++;
    touch(person, m.fecha_operacion);

    // Lo que te devolvió de un gasto que adelantaste, y cuánto tardó.
    const links = m.compensaciones_destinos?.length
      ? m.compensaciones_destinos.map(d => ({ id: d.gasto_id, importe: d.importe }))
      : m.compensa_movimiento_id ? [{ id: m.compensa_movimiento_id, importe: m.importe }] : [];
    for (const link of links) {
      person.adelantado += link.importe;
      const spent = ticketDay(byId.get(link.id)?.fecha_operacion);
      const paid = ticketDay(m.fecha_operacion);
      if (spent !== null && paid !== null && paid >= spent) person.dias.push(paid - spent);
    }
  }

  // 2. Bizum enviados: solo cuentan si el texto nombra a alguien.
  let enviadosSinNombre = 0;
  for (const m of inWindow) {
    if (!isBizumOut(m) || m.es_interno || m.transfer_id) continue;
    const text = m.original_concept ?? m.concepto;
    const known = uniqueMatch(text, people.values());
    // Un nombre nuevo sí abre ficha; uno que ya comparten varias personas no se adivina.
    const candidate = known ? null : personFromConcept(text);
    const named = candidate && ![...people.keys()].some(k => k.split(' ')[0] === candidate.clave.split(' ')[0]) ? candidate : null;
    const person = known ? people.get(known)! : named ? entry(named.clave, named.nombre) : null;
    if (!person) { enviadosSinNombre++; continue; }
    person.enviado += m.importe;
    person.vecesEnviado++;
    touch(person, m.fecha_operacion);
  }

  // 3. Tickets repartidos: lo que cada uno te debe todavía.
  const transferPeople = [...people.values()].filter(p => p.vecesRecibido > 0);
  for (const gasto of inWindow) {
    const personas = gasto.tipo === 'gasto' ? gasto.ticket?.personas : undefined;
    if (!personas?.some(p => !p.yo)) continue;
    const paid = paidTicketPeople(gasto, [...movimientos]);
    personas.forEach((persona, i) => {
      if (persona.yo || paid.has(i) || !(persona.importe > 0)) return;
      const tokens = nameTokens(normalizeTicketText(persona.nombre).split(' ').filter(Boolean));
      if (!tokens.length) return;
      // «Ana» del ticket es la Ana de los Bizum solo si no hay otra Ana; si no, va aparte.
      const clave = ticketOwner(tokens, transferPeople) ?? `ticket:${tokens.join(' ')}`;
      const person = people.get(clave) ?? entry(clave, persona.nombre.trim());
      person.teDebe += persona.importe;
      person.pendientes.push({ gastoId: gasto.id, comercio: gasto.ticket!.comercio, importe: persona.importe, fecha: parseMovimientoDate(gasto.fecha_operacion) });
      touch(person, gasto.fecha_operacion);
    });
  }

  const personas: FriendEntry[] = [...people.values()].map(({ dias, ...p }) => ({
    ...p,
    recibido: round(p.recibido),
    enviado: round(p.enviado),
    teDebe: round(p.teDebe),
    adelantado: round(p.adelantado),
    diasDevolucion: median(dias),
    pendientes: p.pendientes.sort((a, b) => (b.fecha?.getTime() ?? 0) - (a.fecha?.getTime() ?? 0)),
  })).sort((a, b) => b.teDebe - a.teDebe || (b.recibido + b.enviado) - (a.recibido + a.enviado) || a.nombre.localeCompare(b.nombre, 'es'));

  const sum = (pick: (p: FriendEntry) => number) => round(personas.reduce((s, p) => s + pick(p), 0));
  return {
    personas,
    totalTeDeben: sum(p => p.teDebe),
    totalRecibido: sum(p => p.recibido),
    totalEnviado: sum(p => p.enviado),
    totalAdelantado: sum(p => p.adelantado),
    enviadosSinNombre,
  };
}
