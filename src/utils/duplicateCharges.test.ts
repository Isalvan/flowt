import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { findDuplicateCharges } from './movementSuggestions';

const now = new Date('2026-10-11T20:00:00Z');
const charge = (id: string, date = '2026-10-11T12:00:00+02:00', fields: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: 'gasto', concepto: 'Café', importe: 12.50, fecha_operacion: date, ...fields,
});
const pairs = (a = charge('a'), b = charge('b', '2026-10-11T12:15:00+02:00')) => findDuplicateCharges([a, b], now);

describe('posibles cargos duplicados', () => {
  it('incluye el límite de 15 minutos y excluye lo que lo supera', () => {
    expect(pairs()).toHaveLength(1);
    expect(pairs(undefined, charge('b', '2026-10-11T12:15:01+02:00'))).toHaveLength(0);
  });
  it('compara el día natural cuando una fecha no tiene hora, incluida medianoche UTC del backend', () => {
    expect(pairs(charge('a', '2026-10-11'), charge('b', '2026-10-11T19:00:00+02:00'))).toHaveLength(1);
    expect(pairs(charge('a', '2026-10-11T00:00:00+02:00'), charge('b', '2026-10-11'))).toHaveLength(1);
    expect(pairs(charge('a', '2026-10-10'), charge('b', '2026-10-11'))).toHaveLength(0);
  });
  it.each([
    { banco: 'Otro banco' }, { concepto: 'Otro comercio' }, { importe: 12.51 },
    { suscripcion_id: 's' }, { es_interno: true }, { transfer_id: 't' }, { tipo: 'ingreso' as const },
    { duplicados_descartados: ['a'] },
  ])('excluye movimientos incompatibles: %j', fields => {
    expect(pairs(undefined, charge('b', undefined, fields))).toHaveLength(0);
  });
  it('usa el concepto original normalizado y redondea al céntimo', () => {
    expect(pairs(charge('a', undefined, { original_concept: 'CAFÉ', importe: 12.501 }), charge('b', undefined, { concepto: 'Nombre corregido', original_concept: 'cafe' }))).toHaveLength(1);
  });
  it('excluye pares descartados desde cualquiera de los dos lados', () => {
    expect(pairs(charge('a', undefined, { duplicados_descartados: ['b'] }))).toHaveLength(0);
  });
  it.each([
    [{ email_id: 'mail' }, { email_id: 'mail' }],
    [{ id_correo_origen: 'mail' }, { id_correo_origen: 'mail' }],
    [{ email_id: 'mail' }, { id_correo_origen: 'mail' }],
  ])('excluye el mismo correo en ambos campos', (a, b) => {
    expect(pairs(charge('a', undefined, a), charge('b', undefined, b))).toHaveLength(0);
  });
  it('selecciona solo el par más cercano entre tres cargos, sin depender del orden', () => {
    const a = charge('a'), b = charge('b', '2026-10-11T12:10:00+02:00'), c = charge('c', '2026-10-11T12:12:00+02:00');
    expect(findDuplicateCharges([c, a, b], now)).toEqual([{ a: b, b: c }]);
  });
  it('incluye exactamente 60 días y descarta fechas antiguas, futuras o inválidas', () => {
    const boundary = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    expect(pairs(charge('a', boundary), charge('b', boundary))).toHaveLength(1);
    for (const date of ['2026-08-01', '2026-10-12', 'sin fecha']) expect(pairs(charge('a', date), charge('b', date))).toHaveLength(0);
  });
  it('acepta Timestamp y Date sin modificar la entrada', () => {
    const a = charge('a', undefined, { fecha_operacion: { toDate: () => new Date('2026-10-11T10:00:00Z') } });
    const b = charge('b', undefined, { fecha_operacion: new Date('2026-10-11T10:05:00Z') });
    expect(pairs(a, b)).toEqual([{ a, b }]);
    expect(a.duplicados_descartados).toBeUndefined();
  });
});
