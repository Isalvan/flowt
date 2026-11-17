import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { availableAmount, compensationUpdates, suggestCategory, suggestCompensations } from './movementSuggestions';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { paidTicketPeople } from './ticketPayments';

const movement = (id: string, tipo: Movimiento['tipo'], importe: number, concepto = id, date = '2026-05-12T12:00:00+02:00'): Movimiento => ({ id, tipo, importe, concepto, fecha_operacion: date });

describe('compensaciones de tickets', () => {
  const expense: Movimiento = { ...movement('g', 'gasto', 60), ticket: { comercio: 'Mercadona', lineas: [], personas: [{ nombre: 'Yo', importe: 40, yo: true }, { nombre: 'Ana', importe: 20 }] } };
  const income = (amount = 20, date = '2026-05-15', concept = 'Bizum Ana') => movement('i', 'ingreso', amount, concept, date);
  it('matches Ana three days later and prefers the name over a same-day expense', () => {
    const i = income();
    expect(suggestCompensations([expense, i, movement('other', 'gasto', 20, 'Otro', '2026-05-15')])[0])
      .toMatchObject({ gasto: expense, importe: 20, confianza: 'media', motivo: 'Parte de Ana del ticket de Mercadona' });
  });
  it('requires the share amount and the inclusive zero-to-thirty calendar-day window', () => {
    for (const i of [income(22), income(20, '2026-06-21'), income(20, '2026-05-11')]) expect(suggestCompensations([expense, i])).toHaveLength(0);
    expect(suggestCompensations([expense, income(20.01, '2026-06-11')])).toHaveLength(1);
    expect(suggestCompensations([expense, income(20, '2026-06-12')])).toHaveLength(0);
  });
  it('respects dismissals, already paid people and existing allocations', () => {
    expect(suggestCompensations([{ ...expense, compensaciones_descartadas: ['i'] }, income()])).toHaveLength(0);
    expect(suggestCompensations([expense, { ...income(), compensaciones_descartadas: ['g'] }])).toHaveLength(0);
    expect(suggestCompensations([{ ...expense, compensado_por_detalles: [{ ingreso_id: 'paid', importe: 20 }] }, income()])).toHaveLength(0);
    expect(suggestCompensations([expense, { ...income(), compensaciones_destinos: [{ gasto_id: 'g', importe: 20 }] }])).toHaveLength(0);
    expect(suggestCompensations([expense, { ...income(30), compensaciones_destinos: [{ gasto_id: 'other', importe: 10 }] }])).toHaveLength(0);
  });
  it('lowers confidence for equal shares unless the name distinguishes them', () => {
    const g = { ...expense, ticket: { ...expense.ticket!, personas: [{ nombre: 'Yo', importe: 20, yo: true }, { nombre: 'Ana', importe: 20 }, { nombre: 'Luis', importe: 20 }] } };
    expect(suggestCompensations([g, income(20, '2026-05-15', 'Bizum')])[0].confianza).toBe('baja');
    expect(suggestCompensations([g, income(20, '2026-05-15', 'Bizum Luis')])[0]).toMatchObject({ confianza: 'media', motivo: 'Parte de Luis del ticket de Mercadona' });
    const paid = { ...g, compensado_por_detalles: [{ ingreso_id: 'paid', importe: 20 }] };
    const previous = { ...income(20, '2026-05-14', 'Bizum Luis'), id: 'paid' };
    expect([...paidTicketPeople(paid, [previous])]).toEqual([2]);
    expect(suggestCompensations([paid, previous, income(20, '2026-05-15', 'Bizum Luis')])).toHaveLength(0);
    expect(suggestCompensations([paid, previous, income()])[0]?.motivo).toContain('Ana');
  });
  it('settles one person per exact payment, including legacy links', () => {
    const g = { ...expense, compensado_por: ['i'] };
    expect([...paidTicketPeople(g, [income()])]).toEqual([1]);
    expect([...paidTicketPeople(g, [income(20.01)])]).toEqual([]);
  });
});

describe('categorías propuestas', () => {
  it('reconoce comercios y conceptos de Bizum conservando la incertidumbre', () => {
    expect(suggestCategory(movement('g', 'gasto', 20, 'paypal *steam game'))?.categoria).toBe('ocio');
    expect(suggestCategory(movement('g', 'gasto', 20, 'bizum:cine'))).toMatchObject({ categoria: 'ocio', confianza: 'media' });
    expect(suggestCategory(movement('g', 'gasto', 20, 'bizum:comida'))?.confianza).toBe('baja');
  });
  it('no inventa el motivo de un ingreso con el nombre de una persona', () => {
    expect(suggestCategory(movement('i', 'ingreso', 30, 'Persona de ejemplo'))).toMatchObject({ categoria: 'otros_ingresos', confianza: 'baja' });
  });
  it('respeta decisiones confirmadas, valida tipo y excluye transferencias', () => {
    const m = movement('i', 'ingreso', 30);
    expect(suggestCategory({ ...m, categoria: 'regalos', categoria_sugerida: 'nomina' })).toBeNull();
    expect(suggestCategory({ ...m, categoria_sugerida: 'restaurantes' })?.categoria).toBe('otros_ingresos');
    expect(suggestCategory({ ...m, es_interno: true })).toBeNull();
  });
});

describe('posibles compensaciones', () => {
  it.each(['2026-05-12T10:00:00+02:00', '2026-05-12T18:00:00+02:00'])('sugiere el ingreso antes o después del gasto en el mismo día: %s', date => {
    const i = movement('i', 'ingreso', 30, 'Persona de ejemplo', date);
    const g = movement('g', 'gasto', 60, 'Restaurante');
    const suggestions = suggestCompensations([i, g]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ importe: 30, confianza: 'baja' });
    expect(suggestions[0].motivo).toContain('mitad');
    expect(i.compensaciones_destinos).toBeUndefined();
    expect(g.importe_neto).toBeUndefined();
  });
  it('compara días de España incluso cuando UTC cambia de día', () => {
    expect(suggestCompensations([
      movement('i', 'ingreso', 20, 'Persona', '2026-05-11T22:10:00Z'),
      movement('g', 'gasto', 20, 'Tienda', '2026-05-12T18:00:00Z'),
    ])).toHaveLength(1);
  });
  it('descarta días distintos, nóminas, ingresos mayores y repartos arbitrarios', () => {
    const g = movement('g', 'gasto', 60);
    for (const i of [movement('i', 'ingreso', 30, 'Persona', '2026-05-13T12:00:00+02:00'), movement('i', 'ingreso', 60, 'Nómina'), movement('i', 'ingreso', 70), movement('i', 'ingreso', 17)]) {
      expect(suggestCompensations([i, g])).toHaveLength(0);
    }
  });
  it('no vuelve a proponer parejas rechazadas, vinculadas ni internas', () => {
    const i = movement('i', 'ingreso', 30);
    const g = movement('g', 'gasto', 60);
    expect(suggestCompensations([{ ...i, compensaciones_descartadas: ['g'] }, g])).toHaveLength(0);
    expect(suggestCompensations([i, { ...g, transfer_id: 't' }])).toHaveLength(0);
    expect(suggestCompensations([{ ...i, compensaciones_destinos: [{ gasto_id: 'g', importe: 10 }] }, g])).toHaveLength(0);
  });
  it('indica la duda cuando hay varios gastos compatibles', () => {
    const suggestions = suggestCompensations([movement('i', 'ingreso', 30), movement('g1', 'gasto', 30), movement('g2', 'gasto', 30)]);
    expect(suggestions[0].confianza).toBe('baja');
    expect(suggestions[0].motivo).toContain('varios gastos');
  });
});

describe('confirmación sobre saldos actuales', () => {
  it('actualiza ambos lados y el neto sin modificar los objetos originales', () => {
    const g = movement('g', 'gasto', 60);
    const i = movement('i', 'ingreso', 30);
    const updates = compensationUpdates(i, [{ mov: g, importe: 30 }]);
    expect(updates.get('g')).toMatchObject({ importe_neto: 30, compensado_por_detalles: [{ ingreso_id: 'i', importe: 30 }] });
    expect(updates.get('i')).toMatchObject({ compensaciones_destinos: [{ gasto_id: 'g', importe: 30 }] });
    expect(g.importe_neto).toBeUndefined();
  });
  it('mantiene varias compensaciones parciales y valida el total al céntimo', () => {
    const g = { ...movement('g', 'gasto', 60), importe_neto: 40, compensado_por_detalles: [{ ingreso_id: 'anterior', importe: 20 }] };
    const i = movement('i', 'ingreso', 30);
    expect(compensationUpdates(g, [{ mov: i, importe: 30 }]).get('g')?.importe_neto).toBe(10);
    expect(() => compensationUpdates(i, [{ mov: g, importe: 31 }])).toThrow();
    expect(() => compensationUpdates(i, [{ mov: g, importe: 10 }, { mov: g, importe: 10 }])).toThrow();
    expect(() => compensationUpdates(i, [{ mov: { ...g, importe_neto: 0 }, importe: 30 }])).toThrow();
    expect(() => compensationUpdates(i, [{ mov: g, importe: NaN }])).toThrow();
    expect(() => compensationUpdates(i, [{ mov: g, importe: 1.001 }])).toThrow();
    expect(availableAmount({ ...i, compensa_movimiento_id: 'old' })).toBe(0);
  });
  it('impide doble aceptación y movimientos internos', () => {
    const i = { ...movement('i', 'ingreso', 30), compensaciones_destinos: [{ gasto_id: 'g', importe: 30 }] };
    expect(() => compensationUpdates(i, [{ mov: movement('g', 'gasto', 60), importe: 30 }])).toThrow();
    expect(() => compensationUpdates(movement('i', 'ingreso', 30), [{ mov: { ...movement('g', 'gasto', 60), es_interno: true }, importe: 30 }])).toThrow();
  });
  it('refleja el gasto neto y solo la parte no compensada del ingreso en los resúmenes', () => {
    const g = movement('g', 'gasto', 60);
    const i = movement('i', 'ingreso', 40);
    const updates = compensationUpdates(i, [{ mov: g, importe: 30 }]);
    const gasto = { ...g, ...updates.get('g') }, ingreso = { ...i, ...updates.get('i') };
    expect(importeEnEstadisticas(gasto)).toBe(30);
    expect(importeEnEstadisticas(ingreso)).toBe(10);
    expect(cuentaEnEstadisticas(ingreso)).toBe(true);
    expect(importeEnEstadisticas(ingreso) - importeEnEstadisticas(gasto)).toBe(i.importe - g.importe);
  });
});
