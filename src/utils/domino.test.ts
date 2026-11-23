import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { findDominoChains } from './domino';

const now = new Date('2026-11-20T12:00:00Z');
let seq = 0;
const gasto = (concepto: string, fecha: string, importe: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `m${seq++}`, tipo: 'gasto', concepto, importe, fecha_operacion: fecha, ...extra,
});
/** Día n de octubre de 2026 a una hora de Madrid (UTC+2 en octubre hasta el 25). */
const oct = (dia: number, hora = '20:00') => `2026-10-${String(dia).padStart(2, '0')}T${hora}:00+02:00`;
/** Solo fecha: el backend la guarda a medianoche UTC. */
const soloFecha = (dia: number) => `2026-10-${String(dia).padStart(2, '0')}T00:00:00Z`;

/** Cuatro noches de cine con cena, una sin cena, y días de supermercado sueltos. */
function historial(): Movimiento[] {
  const lista: Movimiento[] = [];
  for (const dia of [1, 4, 8, 11]) {
    lista.push(gasto('Cines Yelmo', oct(dia, '19:00'), 9));
    lista.push(gasto('Taberna Sur', oct(dia, '21:30'), 30));
  }
  lista.push(gasto('Cines Yelmo', oct(15, '19:00'), 9));
  for (const dia of [2, 3, 5, 6, 7, 9, 10, 12]) lista.push(gasto('Mercadona', oct(dia, '11:00'), 40));
  return lista;
}

describe('findDominoChains', () => {
  it('encuentra el comercio que suele venir acompañado y lo que cuesta el conjunto', () => {
    const { cadenas, salidas } = findDominoChains(historial(), { now });
    expect(salidas).toBe(13);
    expect(cadenas).toHaveLength(1);
    const [cine] = cadenas;
    expect(cine).toMatchObject({ nombre: 'Cines Yelmo', veces: 5, importeMedio: 9, arrastreTotal: 120, porHora: true });
    expect(cine.acompanantes).toEqual([
      expect.objectContaining({ nombre: 'Taberna Sur', veces: 4, probabilidad: 0.8, importeMedio: 30 }),
    ]);
    expect(cine.costeConjunto).toBe(33);
    expect(cine.multiplicador).toBe(3.7);
  });

  it('no repite la misma cadena al revés', () => {
    const lista = historial();
    lista.push(gasto('Cines Yelmo', oct(18, '19:00'), 9), gasto('Taberna Sur', oct(18, '21:00'), 30));
    // Ahora la taberna también tiene 5 salidas y siempre va con el cine.
    const { cadenas } = findDominoChains(lista, { now });
    expect(cadenas).toHaveLength(1);
  });

  it('parte el día en ratos cuando todo trae hora y lo junta cuando falta', () => {
    const conHueco: Movimiento[] = [];
    for (const dia of [1, 4, 8, 11]) {
      conHueco.push(gasto('Cines Yelmo', oct(dia, '10:00'), 9), gasto('Taberna Sur', oct(dia, '21:30'), 30));
    }
    for (const dia of [2, 3, 5, 6, 7, 9]) conHueco.push(gasto('Mercadona', oct(dia, '11:00'), 40));
    expect(findDominoChains(conHueco, { now }).cadenas).toHaveLength(0);

    const sinHora = conHueco.map(m => m.concepto === 'Taberna Sur'
      ? { ...m, fecha_operacion: soloFecha(Number(String(m.fecha_operacion).slice(8, 10))) }
      : m);
    const [cadena] = findDominoChains(sinHora, { now }).cadenas;
    expect(cadena).toMatchObject({ porHora: false, veces: 4 });
  });

  it('no cuenta una pareja que solo coincide por ser muy frecuente', () => {
    const lista: Movimiento[] = [];
    for (let dia = 1; dia <= 20; dia++) lista.push(gasto('Mercadona', oct(dia, '11:00'), 40));
    for (const dia of [1, 4, 8, 11, 15]) lista.push(gasto('Cines Yelmo', oct(dia, '11:30'), 9));
    // Mercadona va en las 5 salidas del cine, pero también en todas las demás: lift 1.
    expect(findDominoChains(lista, { now }).cadenas).toHaveLength(0);
  });

  it('usa el importe neto y deja fuera ingresos, internos, suscripciones y lo antiguo', () => {
    const lista = historial();
    const taberna = lista.filter(m => m.concepto === 'Taberna Sur');
    taberna[0].importe_neto = 10; // pagó 30, le devolvieron 20 por Bizum
    lista.push(
      gasto('Taberna Sur', oct(15, '21:00'), 30, { es_interno: true }),
      gasto('Taberna Sur', oct(15, '21:05'), 30, { suscripcion_id: 's1' }),
      gasto('Taberna Sur', oct(15, '21:10'), 30, { tipo: 'ingreso' }),
      gasto('Taberna Sur', '2025-09-01T20:00:00+02:00', 30),
    );
    const [cine] = findDominoChains(lista, { now }).cadenas;
    expect(cine.acompanantes[0].veces).toBe(4);
    expect(cine.arrastreTotal).toBe(100);
  });

  it('pide un mínimo de veces y de coincidencias', () => {
    const lista = historial().filter(m => !(m.concepto === 'Taberna Sur' && String(m.fecha_operacion).startsWith('2026-10-11')));
    // 3 coincidencias en 5 salidas sigue valiendo; con minCoincidencias 4 ya no.
    expect(findDominoChains(lista, { now }).cadenas).toHaveLength(1);
    expect(findDominoChains(lista, { now, minCoincidencias: 4 }).cadenas).toHaveLength(0);
    expect(findDominoChains([], { now })).toEqual({ cadenas: [], salidas: 0, desde: null });
  });
});
