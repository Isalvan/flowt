import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { buildFriendsBank, personFromConcept } from './friendsBank';

// Todos los nombres e importes son inventados.
const now = new Date('2026-06-30T12:00:00Z');
let seq = 0;
const mov = (extra: Partial<Movimiento>): Movimiento => ({
  id: `m${++seq}`, tipo: 'ingreso', concepto: '', importe: 10, fecha_operacion: '2026-06-01T10:00:00Z', ...extra,
});

describe('personFromConcept', () => {
  it('recognises the sender name that the bank puts in the concept', () => {
    expect(personFromConcept('lucia ferrer campos')).toEqual({ clave: 'lucia ferrer campos', nombre: 'Lucia Ferrer Campos' });
    expect(personFromConcept('Bizum de Íñigo de la Peña')).toEqual({ clave: 'inigo pena', nombre: 'Inigo de la Pena' });
    expect(personFromConcept('Bizum de Marta')?.clave).toBe('marta');
  });

  it('rejects merchants, organisations, payroll and plain reasons', () => {
    for (const text of ['Nómina octubre', 'Amazon EU SARL devolución', 'Bizum: Cena de ayer (compensación)', 'Agencia Tributaria', 'Marta', 'Talleres Ruiz SL', 'Transferencia 12345', 'bizum:spotify']) {
      expect(personFromConcept(text), text).toBeNull();
    }
  });
});

describe('buildFriendsBank', () => {
  it('adds up what each person sent you and keeps namesakes apart', () => {
    const bank = buildFriendsBank([
      mov({ concepto: 'lucia ferrer campos', importe: 12.5 }),
      mov({ concepto: 'lucia ferrer campos', importe: 7.5, fecha_operacion: '2026-06-20T10:00:00Z' }),
      mov({ concepto: 'lucia prieto sanz', importe: 3 }),
      mov({ concepto: 'Nómina', importe: 1500, categoria: 'nomina' }),
      mov({ concepto: 'pablo ortega vidal', importe: 40, es_interno: true }),
      mov({ concepto: 'pablo ortega vidal', importe: 40, fecha_operacion: '2025-01-01T10:00:00Z' }),
    ], now);
    expect(bank.personas.map(p => [p.nombre, p.recibido, p.vecesRecibido])).toEqual([
      ['Lucia Ferrer Campos', 20, 2],
      ['Lucia Prieto Sanz', 3, 1],
    ]);
    expect(bank.totalRecibido).toBe(23);
    expect(bank.personas[0].ultimo?.toISOString()).toBe('2026-06-20T10:00:00.000Z');
  });

  it('attributes an outgoing Bizum only when its text names someone', () => {
    const bank = buildFriendsBank([
      mov({ concepto: 'lucia ferrer campos', importe: 20 }),
      mov({ tipo: 'gasto', concepto: 'Bizum entradas Lucia', importe: 15 }),
      mov({ tipo: 'gasto', concepto: 'bizum:spotify', importe: 4 }),
      mov({ tipo: 'gasto', concepto: 'Mercadona', importe: 30 }),
    ], now);
    expect(bank.personas[0]).toMatchObject({ clave: 'lucia ferrer campos', recibido: 20, enviado: 15, vecesEnviado: 1 });
    expect(bank.enviadosSinNombre).toBe(1);
    expect(bank.totalEnviado).toBe(15);
  });

  it('does not guess between two people with the same first name', () => {
    const bank = buildFriendsBank([
      mov({ concepto: 'lucia ferrer campos' }),
      mov({ concepto: 'lucia prieto sanz' }),
      mov({ tipo: 'gasto', concepto: 'Bizum Lucia', importe: 5 }),
      mov({ tipo: 'gasto', concepto: 'Bizum Lucia Prieto', importe: 6 }),
    ], now);
    expect(bank.personas.find(p => p.clave === 'lucia prieto sanz')?.enviado).toBe(6);
    expect(bank.personas.find(p => p.clave === 'lucia ferrer campos')?.enviado).toBe(0);
    expect(bank.enviadosSinNombre).toBe(1);
  });

  it('shows unpaid ticket shares as debts and what was fronted and paid back', () => {
    const gasto = mov({
      id: 'cena', tipo: 'gasto', concepto: 'Asador', importe: 60, fecha_operacion: '2026-06-10T21:00:00Z',
      compensado_por_detalles: [{ ingreso_id: 'devuelto', importe: 20 }],
      ticket: { comercio: 'Asador', lineas: [], personas: [{ nombre: 'Yo', importe: 20, yo: true }, { nombre: 'Pablo', importe: 20 }, { nombre: 'Nora', importe: 20 }] },
    });
    const bank = buildFriendsBank([
      gasto,
      mov({ id: 'devuelto', concepto: 'pablo ortega vidal', importe: 20, fecha_operacion: '2026-06-13T09:00:00Z', compensa_movimiento_id: 'cena' }),
    ], now);
    const pablo = bank.personas.find(p => p.clave === 'pablo ortega vidal')!;
    expect(pablo).toMatchObject({ recibido: 20, adelantado: 20, diasDevolucion: 3, teDebe: 0 });
    const nora = bank.personas.find(p => p.nombre === 'Nora')!;
    expect(nora).toMatchObject({ clave: 'ticket:nora', teDebe: 20 });
    expect(nora.pendientes).toEqual([{ gastoId: 'cena', comercio: 'Asador', importe: 20, fecha: new Date('2026-06-10T21:00:00Z') }]);
    expect(bank.personas[0].nombre).toBe('Nora');
    expect(bank.totalTeDeben).toBe(20);
    expect(bank.totalAdelantado).toBe(20);
  });

  it('joins a ticket name to the only person with that first name', () => {
    const bank = buildFriendsBank([
      mov({ concepto: 'nora gil soto', importe: 8 }),
      mov({ tipo: 'gasto', concepto: 'Pizzeria', importe: 30, ticket: { comercio: 'Pizzeria', lineas: [], personas: [{ nombre: 'Yo', importe: 15, yo: true }, { nombre: 'Nora G', importe: 15 }] } }),
    ], now);
    expect(bank.personas).toHaveLength(1);
    expect(bank.personas[0]).toMatchObject({ clave: 'nora gil soto', recibido: 8, teDebe: 15 });
  });

  it('is empty without people', () => {
    expect(buildFriendsBank([mov({ concepto: 'Nómina' })], now)).toEqual({
      personas: [], totalTeDeben: 0, totalRecibido: 0, totalEnviado: 0, totalAdelantado: 0, enviadosSinNombre: 0,
    });
  });
});
