import type { Movimiento } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { hasMovementTime, movementDate } from './movementSuggestions';
import { normalizeServiceName } from './serviceNames';

/**
 * Dominó: compras que suelen venir acompañadas de otras.
 *
 * Una «salida» es el conjunto de gastos de un mismo día. Cuando todos los
 * gastos de ese día traen hora, el día se parte en ratos separados por más de
 * `ventanaHoras`; si alguno no la trae (el banco solo dio la fecha), el día
 * entero cuenta como una sola salida. Así nunca se inventa un orden que los
 * datos no tienen.
 *
 * Para cada comercio se buscan los que aparecen con él más de lo que aparecen
 * en una salida cualquiera (lift). Es asociación, no causa.
 */

export interface DominoAcompanante {
  clave: string;
  nombre: string;
  /** Salidas con los dos comercios. */
  veces: number;
  /** Parte de las salidas del disparador en las que aparece (0..1). */
  probabilidad: number;
  /** Cuánto más aparece con el disparador que en una salida cualquiera. */
  lift: number;
  /** Gasto medio en este comercio cuando va con el disparador. */
  importeMedio: number;
}

export interface DominoCadena {
  clave: string;
  nombre: string;
  /** Salidas en las que aparece el disparador. */
  veces: number;
  /** Gasto medio en el disparador por salida. */
  importeMedio: number;
  acompanantes: DominoAcompanante[];
  /** Lo que suele costar el conjunto: disparador + acompañantes por su probabilidad. */
  costeConjunto: number;
  /** costeConjunto / importeMedio. */
  multiplicador: number;
  /** Gasto real en los acompañantes durante esas salidas. */
  arrastreTotal: number;
  /** Si la mayoría de esas salidas se midieron por hora (no por día). */
  porHora: boolean;
}

export interface DominoResumen {
  cadenas: DominoCadena[];
  salidas: number;
  desde: Date | null;
}

export interface DominoOpciones {
  now?: Date;
  ventanaHoras?: number;
  meses?: number;
  minVeces?: number;
  minCoincidencias?: number;
  minProbabilidad?: number;
  minLift?: number;
  maxAcompanantes?: number;
}

interface Compra { clave: string; nombre: string; importe: number; fecha: Date; conHora: boolean }
interface Salida { importes: Map<string, number>; porHora: boolean }

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
const cents = (value: number) => Math.round(value * 100) / 100;
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

const claveDe = (m: Movimiento): string => normalizeServiceName(m.concepto?.trim() ?? '');

function compras(movimientos: readonly Movimiento[], desde: Date, hasta: Date): Compra[] {
  const result: Compra[] = [];
  for (const m of movimientos) {
    if (m.tipo !== 'gasto' || !cuentaEnEstadisticas(m) || m.suscripcion_id) continue;
    const fecha = movementDate(m);
    if (!fecha || fecha < desde || fecha > hasta) continue;
    const importe = importeEnEstadisticas(m);
    const clave = claveDe(m);
    if (!(importe > 0.005) || !clave) continue;
    result.push({ clave, nombre: m.concepto.trim(), importe, fecha, conHora: hasMovementTime(m) });
  }
  return result.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
}

function agruparSalidas(lista: readonly Compra[], ventanaMs: number): Salida[] {
  const porDia = new Map<string, Compra[]>();
  for (const compra of lista) {
    const dia = dayFormatter.format(compra.fecha);
    const del = porDia.get(dia);
    if (del) del.push(compra); else porDia.set(dia, [compra]);
  }
  const salidas: Salida[] = [];
  const cerrar = (grupo: Compra[], porHora: boolean) => {
    const importes = new Map<string, number>();
    for (const c of grupo) importes.set(c.clave, (importes.get(c.clave) ?? 0) + c.importe);
    salidas.push({ importes, porHora });
  };
  for (const dia of porDia.values()) {
    if (!dia.every(c => c.conHora)) { cerrar(dia, false); continue; }
    let grupo: Compra[] = [dia[0]];
    for (const c of dia.slice(1)) {
      if (c.fecha.getTime() - grupo[grupo.length - 1].fecha.getTime() > ventanaMs) {
        cerrar(grupo, true);
        grupo = [c];
      } else grupo.push(c);
    }
    cerrar(grupo, true);
  }
  return salidas;
}

/** Busca las cadenas de gasto, la que más ha arrastrado primero. */
export function findDominoChains(movimientos: readonly Movimiento[], opciones: DominoOpciones = {}): DominoResumen {
  const {
    now = new Date(), ventanaHoras = 3, meses = 12, minVeces = 4, minCoincidencias = 3,
    minProbabilidad = 0.4, minLift = 1.5, maxAcompanantes = 3,
  } = opciones;
  const desde = new Date(now);
  desde.setMonth(desde.getMonth() - meses);
  const lista = compras(movimientos, desde, now);
  const salidas = agruparSalidas(lista, ventanaHoras * 3_600_000);
  if (salidas.length === 0) return { cadenas: [], salidas: 0, desde: null };

  // El nombre que se muestra es el último con el que el usuario vio el comercio.
  const nombres = new Map<string, string>();
  for (const c of lista) nombres.set(c.clave, c.nombre);

  const frecuencia = new Map<string, number>();
  for (const s of salidas) for (const clave of s.importes.keys()) frecuencia.set(clave, (frecuencia.get(clave) ?? 0) + 1);

  const cadenas: DominoCadena[] = [];
  for (const [clave, veces] of frecuencia) {
    if (veces < minVeces) continue;
    const suyas = salidas.filter(s => s.importes.has(clave));
    const importeMedio = suyas.reduce((sum, s) => sum + s.importes.get(clave)!, 0) / veces;

    const juntos = new Map<string, { veces: number; total: number }>();
    for (const s of suyas) {
      for (const [otra, importe] of s.importes) {
        if (otra === clave) continue;
        const acc = juntos.get(otra) ?? { veces: 0, total: 0 };
        acc.veces += 1;
        acc.total += importe;
        juntos.set(otra, acc);
      }
    }

    const acompanantes: DominoAcompanante[] = [];
    for (const [otra, { veces: coincidencias, total }] of juntos) {
      const probabilidad = coincidencias / veces;
      const base = frecuencia.get(otra)! / salidas.length;
      const lift = probabilidad / base;
      if (coincidencias < minCoincidencias || probabilidad < minProbabilidad || lift < minLift) continue;
      acompanantes.push({
        clave: otra, nombre: nombres.get(otra)!, veces: coincidencias, probabilidad,
        lift: oneDecimal(lift), importeMedio: cents(total / coincidencias),
      });
    }
    if (acompanantes.length === 0) continue;
    acompanantes.sort((a, b) => b.probabilidad * b.importeMedio - a.probabilidad * a.importeMedio || a.nombre.localeCompare(b.nombre));
    const elegidos = acompanantes.slice(0, maxAcompanantes);

    const costeConjunto = importeMedio + elegidos.reduce((sum, a) => sum + a.probabilidad * a.importeMedio, 0);
    const arrastreTotal = suyas.reduce((sum, s) => sum + elegidos.reduce((acc, a) => acc + (s.importes.get(a.clave) ?? 0), 0), 0);
    cadenas.push({
      clave, nombre: nombres.get(clave)!, veces, importeMedio: cents(importeMedio), acompanantes: elegidos,
      costeConjunto: cents(costeConjunto), multiplicador: oneDecimal(costeConjunto / importeMedio),
      arrastreTotal: cents(arrastreTotal), porHora: suyas.filter(s => s.porHora).length * 2 > veces,
    });
  }

  cadenas.sort((a, b) => b.arrastreTotal - a.arrastreTotal || b.veces - a.veces || a.nombre.localeCompare(b.nombre));
  // «Cine → cena» y «cena → cine» cuentan lo mismo: se queda la que más arrastra.
  const vistas: Set<string>[] = [];
  const unicas = cadenas.filter(c => {
    const grupo = new Set([c.clave, ...c.acompanantes.map(a => a.clave)]);
    if (vistas.some(v => [...grupo].every(clave => v.has(clave)))) return false;
    vistas.push(grupo);
    return true;
  });
  return { cadenas: unicas, salidas: salidas.length, desde: lista[0]?.fecha ?? null };
}
