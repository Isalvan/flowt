import type { Movimiento } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { hasMovementTime, movementDate } from './movementSuggestions';

/**
 * Reloj del gasto: a qué horas del día y qué días de la semana se concentra el gasto.
 *
 * La hora solo existe a veces: el aviso del banco la trae (o Gemini usa la hora de envío del
 * correo, que en los avisos de tarjeta coincide con el pago); una fecha sin hora se guarda a
 * medianoche y `hasMovementTime` la descarta. Por eso el día de la semana usa todos los gastos y
 * el reloj de 24 h solo los que traen hora, y se oculta si son pocos.
 */

export const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
/** Gastos con hora necesarios para dibujar el reloj. */
export const MIN_GASTOS_CON_HORA = 12;
/** Parte mínima de los gastos que debe traer hora; por debajo, el reloj contaría solo una minoría. */
export const MIN_PARTE_CON_HORA = 0.25;
/** Ancho de la franja destacada, en horas. */
export const HORAS_FRANJA = 3;
/** Un banco cuyos avisos repiten el mismo minuto los manda por lotes: su hora no es la del pago. */
const MIN_AVISOS_LOTE = 6;
const PARTE_MISMO_MINUTO = 0.6;

export interface ClockHour { hora: number; total: number; count: number }
export interface ClockWeekday {
  /** 0 = lunes … 6 = domingo. */
  dia: number;
  nombre: (typeof DIAS_SEMANA)[number];
  total: number;
  count: number;
  /** Cuántos días de este tipo caen en el intervalo observado. */
  dias: number;
  /** Gasto medio en un día de este tipo (total / dias). */
  media: number;
}
export interface ClockWindow {
  /** Hora de inicio (0–23); la franja puede cruzar la medianoche. */
  desde: number;
  /** Hora de fin, exclusiva (módulo 24); la franja dura como mucho HORAS_FRANJA horas. */
  hasta: number;
  total: number;
  count: number;
  /** Parte del gasto con hora que cae en la franja (0–1). */
  parte: number;
}
export interface SpendingClock {
  gastos: number;
  total: number;
  conHora: number;
  /** Hay suficientes gastos con hora como para que el reloj diga algo. */
  horasFiables: boolean;
  horas: ClockHour[];
  franja: ClockWindow | null;
  dias: ClockWeekday[];
  diaPico: ClockWeekday | null;
  /** Veces que el día pico supera la media de los días observados. */
  vecesMedia: number | null;
  /** Bancos cuyas horas se descartan porque avisan por lotes. */
  bancosPorLotes: string[];
}

const madridParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
interface Local { day: number; hour: number; minute: number; weekday: number }
/** Día de la semana (0 = lunes) de un número de día desde 1970: el 1 de enero de 1970 fue jueves. */
const weekdayOf = (day: number) => (((day + 3) % 7) + 7) % 7;
const local = (date: Date): Local => {
  const p = Object.fromEntries(madridParts.formatToParts(date).map(part => [part.type, part.value]));
  const day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000;
  return { day, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: weekdayOf(day) };
};
const round = (value: number) => Math.round(value * 100) / 100;

interface Gasto { importe: number; at: Local; conHora: boolean; banco: string }

export function spendingClock(movimientos: readonly Movimiento[]): SpendingClock {
  const gastos: Gasto[] = [];
  for (const m of movimientos) {
    // Las suscripciones y domiciliaciones se cobran solas: no dicen nada de cuándo decides gastar.
    if (m.tipo !== 'gasto' || !cuentaEnEstadisticas(m) || m.suscripcion_id) continue;
    const date = movementDate(m);
    const importe = importeEnEstadisticas(m);
    if (!date || !(importe > 0)) continue;
    gastos.push({ importe, at: local(date), conHora: hasMovementTime(m), banco: m.banco?.trim() || '' });
  }

  const bancosPorLotes = batchBanks(gastos);
  const conHora = gastos.filter(g => g.conHora && !bancosPorLotes.includes(g.banco));
  const horas: ClockHour[] = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0, count: 0 }));
  for (const g of conHora) {
    horas[g.at.hour].total += g.importe;
    horas[g.at.hour].count += 1;
  }
  horas.forEach(h => { h.total = round(h.total); });
  const horasFiables = conHora.length >= MIN_GASTOS_CON_HORA && conHora.length >= gastos.length * MIN_PARTE_CON_HORA;

  const dias = weekdays(gastos);
  const observados = dias.filter(d => d.dias > 0);
  const mediaGeneral = observados.length ? observados.reduce((s, d) => s + d.media, 0) / observados.length : 0;
  const diaPico = gastos.length && observados.length >= 2
    ? observados.reduce((best, d) => d.media > best.media ? d : best)
    : null;

  return {
    gastos: gastos.length,
    total: round(gastos.reduce((s, g) => s + g.importe, 0)),
    conHora: conHora.length,
    horasFiables,
    horas,
    franja: horasFiables ? peakWindow(horas) : null,
    dias,
    diaPico,
    vecesMedia: diaPico && mediaGeneral > 0 ? Math.round((diaPico.media / mediaGeneral) * 10) / 10 : null,
    bancosPorLotes,
  };
}

function batchBanks(gastos: Gasto[]): string[] {
  const byBank = new Map<string, Map<number, number>>();
  for (const g of gastos) {
    if (!g.conHora) continue;
    const minutes = byBank.get(g.banco) ?? new Map<number, number>();
    const key = g.at.hour * 60 + g.at.minute;
    minutes.set(key, (minutes.get(key) ?? 0) + 1);
    byBank.set(g.banco, minutes);
  }
  return [...byBank].filter(([, minutes]) => {
    const total = [...minutes.values()].reduce((s, n) => s + n, 0);
    return total >= MIN_AVISOS_LOTE && Math.max(...minutes.values()) >= total * PARTE_MISMO_MINUTO;
  }).map(([banco]) => banco).sort();
}

function weekdays(gastos: Gasto[]): ClockWeekday[] {
  const dias: ClockWeekday[] = DIAS_SEMANA.map((nombre, dia) => ({ dia, nombre, total: 0, count: 0, dias: 0, media: 0 }));
  if (!gastos.length) return dias;
  for (const g of gastos) {
    dias[g.at.weekday].total += g.importe;
    dias[g.at.weekday].count += 1;
  }
  // Cuántos lunes, martes… hay entre el primer y el último gasto: un mes puede traer cinco sábados.
  const first = Math.min(...gastos.map(g => g.at.day));
  const last = Math.max(...gastos.map(g => g.at.day));
  for (let day = first; day <= last; day++) dias[weekdayOf(day)].dias += 1;
  dias.forEach(d => {
    d.total = round(d.total);
    d.media = d.dias ? round(d.total / d.dias) : 0;
  });
  return dias;
}

/** La franja de hasta HORAS_FRANJA horas seguidas (cruzando medianoche) con más gasto. */
function peakWindow(horas: ClockHour[]): ClockWindow | null {
  const total = horas.reduce((s, h) => s + h.total, 0);
  if (total <= 0) return null;
  let best: ClockWindow | null = null;
  for (let desde = 0; desde < 24; desde++) {
    const slice = Array.from({ length: HORAS_FRANJA }, (_, i) => horas[(desde + i) % 24]);
    const sum = round(slice.reduce((s, h) => s + h.total, 0));
    if (!best || sum > best.total) {
      best = { desde, hasta: (desde + HORAS_FRANJA) % 24, total: sum, count: slice.reduce((s, h) => s + h.count, 0), parte: 0 };
    }
  }
  if (!best) return null;
  // Las horas vacías en los bordes no forman parte de la franja: «21–22», no «19–22».
  let { desde, hasta } = best;
  while (horas[desde].total === 0) desde = (desde + 1) % 24;
  while (horas[(hasta + 23) % 24].total === 0) hasta = (hasta + 23) % 24;
  return { ...best, desde, hasta, parte: best.total / total };
}

export const hourLabel = (hora: number) => `${String(hora).padStart(2, '0')}:00`;
export const windowLabel = (w: Pick<ClockWindow, 'desde' | 'hasta'>) => `${hourLabel(w.desde)}–${hourLabel(w.hasta)}`;
/** Nombre en plural para frases: «los sábados». */
export const weekdayPlural = (nombre: string) => (nombre.endsWith('s') ? nombre : `${nombre}s`);

/** Titular del reloj, sin importes (los importes van aparte para respetar la privacidad). */
export function clockHeadline(clock: SpendingClock): string {
  if (clock.franja) {
    return `Entre las ${hourLabel(clock.franja.desde)} y las ${hourLabel(clock.franja.hasta)} se va el ${Math.round(clock.franja.parte * 100)} % de lo que gastas`;
  }
  if (clock.diaPico && clock.vecesMedia && clock.vecesMedia > 1) {
    return `Los ${weekdayPlural(clock.diaPico.nombre)} gastas ${clock.vecesMedia.toLocaleString('es-ES')} veces lo de un día normal`;
  }
  return 'Así se reparte tu gasto en la semana';
}
