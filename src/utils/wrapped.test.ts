import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { availableWrappeds, buildWrapped, featuredWrapped, selectHighlights, type WrappedHighlight, type WrappedPeriod } from './wrapped';

const d = (month: number, date = 1, year = 2026) => new Date(year, month - 1, date);
const now = d(11, 3);
const october: WrappedPeriod = { scope: 'mes', key: 'mes:2026-10', label: 'octubre', start: d(10), end: d(11) };
const annual: WrappedPeriod = { scope: 'anio', key: 'anio:2026', label: '2026', start: d(1), end: d(1, 1, 2027) };
const expense = (overrides: Partial<Movimiento> = {}): Movimiento => ({
  id: 'gasto', tipo: 'gasto', concepto: 'Tienda', importe: 10, fecha_operacion: d(10, 5), ...overrides,
});
const five = (overrides: Partial<Movimiento> = {}) => Array.from({ length: 5 }, (_, i) => expense({ id: `g${i}`, ...overrides }));
const build = (movements = five(), period = october) => buildWrapped(movements, period, { now })!;

describe('buildWrapped', () => {
  it('requiere cinco gastos externos positivos, con fecha válida y en [start,end)', () => {
    expect(buildWrapped(five().slice(1), october, { now })).toBeNull();
    const excluded = [
      expense({ es_interno: true }), expense({ transfer_id: 't' }),
      expense({ importe_neto: 0 }), expense({ fecha_operacion: 'inválida' }),
      expense({ fecha_operacion: d(11) }), expense({ fecha_operacion: d(9, 30) }),
    ];
    expect(buildWrapped([...five().slice(1), ...excluded], october, { now })).toBeNull();
    expect(build(five({ fecha_operacion: d(10) })).totales.numGastos).toBe(5);
  });

  it('excluye internos, transferencias y reembolsos y respeta netos y céntimos', () => {
    const movements = [
      ...five({ importe: 100, importe_neto: 0.1 }),
      expense({ importe: 500, es_interno: true }), expense({ importe: 500, transfer_id: 't' }),
      expense({ tipo: 'ingreso', importe: 500, compensa_movimiento_id: 'gasto' }),
      expense({ tipo: 'ingreso', importe: 500, compensaciones_destinos: [{ gasto_id: 'gasto', importe: 500 }] }),
      expense({ tipo: 'ingreso', importe: 100, compensaciones_destinos: [{ gasto_id: 'gasto', importe: 20 }] }),
      expense({ tipo: 'ingreso', importe: 900, es_interno: true }),
    ];
    const result = build(movements);
    expect(result.totales).toEqual({ ingresos: 80, gastos: 0.5, ahorro: 79.5, tasaAhorro: 99.38, numGastos: 5, numComercios: 1 });
    expect(result.serieDiaria.find(row => +row.fecha === +d(10, 5))?.total).toBe(0.5);
    expect(result.compraMayor.importe).toBe(0.1);
    expect(result.pequenas.total).toBe(0.5);
    expect(build(five()).totales.tasaAhorro).toBeNull();
  });

  it('agrupa referencias de Mercadona, usa el concepto más reciente y desempata por importe', () => {
    const result = build([
      expense({ concepto: 'Mercadona 5678', importe: 30, fecha_operacion: d(10, 8) }),
      expense({ concepto: 'MERCADONA 1234 MADRID', importe: 20 }),
      expense({ concepto: 'Panadería', importe: 10 }), expense({ concepto: 'Panadería', importe: 15 }),
      expense({ concepto: 'Muebles', importe: 100 }),
      expense({ concepto: 'Netflix', importe: 200, suscripcion_id: 's' }),
      expense({ concepto: 'Nómina', tipo: 'ingreso', importe: 100 }),
      expense({ concepto: '12 AB' }),
    ]);
    expect(result.comercioFavorito).toEqual({ key: 'mercadona', nombre: 'Mercadona 5678', visitas: 2, total: 50 });
    expect(result.comercioTop?.nombre).toBe('Muebles');
    expect(result.totales.numComercios).toBe(3);
    expect(result.suscripciones).toBe(200);
  });

  it('reutiliza alias de servicios y admite no tener comercios reconocibles', () => {
    const result = build([
      ...five({ concepto: 'OPENAI 1234' }), expense({ concepto: 'ChatGPT', fecha_operacion: d(10, 20) }),
    ]);
    expect(result.comercioFavorito).toEqual({ key: 'chatgpt', nombre: 'ChatGPT', visitas: 6, total: 60 });
    expect(build(five({ suscripcion_id: 's' })).comercioFavorito).toBeNull();
    expect(build(five({ concepto: '12' })).comercioTop).toBeNull();
  });

  it('devuelve las tres primeras categorías, con respaldo sugerido y labels personalizados', () => {
    const result = buildWrapped([
      expense({ categoria: 'vivienda', importe: 100 }),
      expense({ categoria_sugerida: 'alimentacion', importe: 50 }),
      expense({ categoria: 'ocio', categoria_sugerida: 'vivienda', importe: 30 }),
      expense({ categoria: 'propia', importe: 20 }), expense({ importe: 10 }),
    ], october, { now, categoryLabel: id => `Etiqueta ${id}` })!;
    expect(result.topCategorias).toEqual([
      { categoria: 'vivienda', label: 'Etiqueta vivienda', total: 100, porcentaje: 47.62 },
      { categoria: 'alimentacion', label: 'Etiqueta alimentacion', total: 50, porcentaje: 23.81 },
      { categoria: 'ocio', label: 'Etiqueta ocio', total: 30, porcentaje: 14.29 },
    ]);
    expect(build(five({ categoria: 'ocio' })).topCategorias[0].label).toBe('Ocio');
  });

  it('calcula día, semana ISO, compra mayor y serie diaria con días vacíos', () => {
    const result = build([
      expense({ fecha_operacion: d(10, 4), importe: 50 }), // Sunday, previous ISO week.
      expense({ fecha_operacion: d(10, 5), importe: 20 }),
      expense({ fecha_operacion: d(10, 6), importe: 30 }),
      expense({ fecha_operacion: d(10, 11), importe: 40 }),
      expense({ concepto: 'Compra mayor', fecha_operacion: d(10, 18), importe: 60 }),
    ]);
    expect(result.diaMasCaro).toEqual({ fecha: d(10, 18), total: 60 });
    expect(result.semanaMasCara).toEqual({ fecha: d(10, 5), total: 90 });
    expect(result.compraMayor).toEqual({ concepto: 'Compra mayor', importe: 60, fecha: d(10, 18) });
    expect(result.serieDiaria).toHaveLength(31);
    expect(result.serieDiaria[0]).toEqual({ fecha: d(10), total: 0 });
    expect(result.diaSemanaFavorito).toEqual({ dia: 6, porcentaje: 75 });
    expect(result.mesMasCaro).toBeNull();
    expect(result.serieMensual).toEqual([]);
  });

  it('calcula meses más caro y barato con doce valores, incluyendo meses sin gastos', () => {
    const result = build([
      ...five({ fecha_operacion: d(2, 5), importe: 20 }),
      expense({ fecha_operacion: d(3, 10), importe: 150 }),
    ], annual);
    expect(result.mesMasCaro).toEqual({ mes: 2, total: 150 });
    expect(result.mesMasBarato).toEqual({ mes: 0, total: 0 });
    expect(result.serieMensual).toEqual([0, 100, 150, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.diaMasCaro).toBeNull();
    expect(result.serieDiaria).toEqual([]);
  });

  it('la racha anual parcial no cuenta días futuros y los internos no la interrumpen', () => {
    const partial: WrappedPeriod = { ...annual, end: d(12, 5), parcial: true };
    const result = buildWrapped([
      ...five({ fecha_operacion: d(1), importe: 1 }),
      expense({ fecha_operacion: d(6), es_interno: true }),
      expense({ fecha_operacion: d(7), transfer_id: 't' }),
      expense({ fecha_operacion: d(8), importe_neto: 0 }),
    ], partial, { now: d(1, 7) })!;
    expect(result.rachaSinGastos).toEqual({ dias: 6, desde: d(1, 2), hasta: d(1, 7) });
    expect(result.mesMasBarato).toEqual({ mes: 0, total: 5 });
    const noStreak = buildWrapped(five(), { ...october, end: d(10, 6) }, { now: d(10, 5) })!;
    expect(noStreak.rachaSinGastos).toEqual({ dias: 4, desde: d(10), hasta: d(10, 4) });
  });

  it('compara con el periodo anterior y devuelve null sin gastos previos', () => {
    expect(build().comparativa).toBeNull();
    const result = build([...five(), expense({ fecha_operacion: d(9, 5), importe: 100 })]);
    expect(result.comparativa).toEqual({ gastosAnterior: 100, deltaPct: -50 });
    expect(result.curiosidades[0]).toBe('Gastaste un 50 % menos que en septiembre.');
    expect(build([...five(), expense({ fecha_operacion: d(9, 5), importe_neto: 0 })]).comparativa).toBeNull();
    const custom = buildWrapped([...five(), expense({ fecha_operacion: d(8, 5), importe: 25 })], october,
      { now, previous: { start: d(8), end: d(9) } })!;
    expect(custom.comparativa?.deltaPct).toBe(100);
    expect(custom.curiosidades[0]).toContain('agosto');
    const year = build([...five(), expense({ fecha_operacion: d(9, 5, 2025), importe: 100 })], annual);
    expect(year.curiosidades[0]).toContain('2025');
  });

  it.each([
    ['alimentacion', 'Chef de casa'], ['restaurantes', 'Foodie'], ['ocio', 'Alma de la fiesta'],
    ['transporte', 'Siempre en ruta'], ['compras', 'Cazador de caprichos'], ['tecnologia', 'Geek'],
    ['salud', 'Modo bienestar'], ['formacion', 'Eterno aprendiz'], ['inversion', 'Futuro rentista'],
    ['vivienda', 'Equilibrista'], ['propia', 'Equilibrista'],
  ])('personalidad para %s, saltando vivienda si hay otra categoría', (categoria, titulo) => {
    const result = build([...five({ categoria }), expense({ categoria: 'vivienda', importe: 1000 })]);
    expect(result.personalidad.titulo).toBe(titulo);
    expect(result.personalidad.descripcion.length).toBeGreaterThan(0);
  });

  it('Hormiguita gana con ahorro >= 30 %, pero no con menos', () => {
    const expenses = five({ importe: 14, categoria: 'ocio' });
    expect(build([...expenses, expense({ tipo: 'ingreso', importe: 100 })]).personalidad.titulo).toBe('Hormiguita');
    expect(build([...expenses, expense({ tipo: 'ingreso', importe: 99 })]).personalidad.titulo).toBe('Alma de la fiesta');
  });

  it('curiosidades en orden, máximo cuatro, dinero español y reglas de umbral', () => {
    const result = build([...five({ importe: 2 }), expense({ fecha_operacion: d(9, 5), importe: 20 })]);
    expect(result.curiosidades).toEqual([
      'Gastaste un 50 % menos que en septiembre.',
      'Pasaste por Tienda 5 veces: una cada 6 días.',
      'Estuviste 26 días seguidos sin gastar un euro.',
      `5 compras de menos de 5 € sumaron ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(10)}.`,
    ]);
    const noRules = five({ importe: 5, suscripcion_id: 's' }).map((m, i) => ({ ...m, fecha_operacion: d(10, i + 1) }));
    expect(buildWrapped(noRules, { ...october, end: d(10, 6) }, { now })!.curiosidades).toEqual([]);
    const weekday = build(five({ importe: 5, suscripcion_id: 's', fecha_operacion: d(10, 3) }));
    expect(weekday.curiosidades).toContain('Los sábados son tu día: el 100 % de tu gasto.');
  });

  it.each([[95, true], [95.01, false], [105, true], [104.99, false]])('umbral comparativa con gasto %s', (amount, applies) => {
    const result = build([...five().slice(1), expense({ importe: amount - 40 }), expense({ fecha_operacion: d(9, 5), importe: 100 })]);
    expect(result.curiosidades.some(text => text.startsWith('Gastaste'))).toBe(applies);
  });

  it('aplica los límites inclusivos de racha, pequeñas y día favorito', () => {
    const short: WrappedPeriod = { ...october, end: d(10, 9) };
    const movements = five({ suscripcion_id: 's', importe: 5 }).map((m, i) => ({ ...m, fecha_operacion: d(10, i + 1) }));
    expect(buildWrapped(movements, short, { now })!.curiosidades).toEqual(['Estuviste 3 días seguidos sin gastar un euro.']);
    expect(buildWrapped(movements, { ...short, end: d(10, 8) }, { now })!.curiosidades).toEqual([]);
    const small = [...five({ importe: 4.99 }).slice(1), expense({ importe: 5 })];
    expect(build(small).curiosidades.some(text => text.includes('compras de menos'))).toBe(false);
    expect(build(five({ importe: 4.99 })).curiosidades.some(text => text.includes('5 compras de menos'))).toBe(true);
    const weekdays = Array.from({ length: 7 }, (_, i) => expense({
      suscripcion_id: 's', importe: i === 2 ? 2 : 1, fecha_operacion: d(10, i + 1),
    }));
    expect(build(weekdays).curiosidades).toContain('Los sábados son tu día: el 25 % de tu gasto.');
    expect(build(weekdays.map(m => ({ ...m, importe: 1 }))).curiosidades.some(text => text.startsWith('Los '))).toBe(false);
  });

  it('la frecuencia del favorito usa días naturales y expresa una cada dos días', () => {
    const result = buildWrapped(Array.from({ length: 14 }, (_, i) => expense({ fecha_operacion: d(2, i * 2 + 1) })),
      { ...october, key: 'mes:2026-02', label: 'febrero', start: d(2), end: d(3) }, { now })!;
    expect(result.curiosidades).toContain('Pasaste por Tienda 14 veces: una cada dos días.');
  });

  it('no modifica movimientos, fechas ni opciones de entrada', () => {
    const movements = five();
    const snapshot = structuredClone(movements);
    const periodSnapshot = structuredClone(october);
    build(movements);
    expect(movements).toEqual(snapshot);
    expect(october).toEqual(periodSnapshot);
    expect(now).toEqual(d(11, 3));
  });
});

describe('availableWrappeds', () => {
  it('el 3 de noviembre ofrece octubre y anteriores válidos, nunca el actual', () => {
    const movements = [...five(), ...five({ fecha_operacion: d(9, 2) }), ...five({ fecha_operacion: d(11, 2) })];
    expect(availableWrappeds(movements, now, 1).map(p => p.key)).toEqual(['mes:2026-10', 'mes:2026-09']);
    expect(availableWrappeds(movements, now, 1)[0]).toEqual(october);
    expect(availableWrappeds([], now, 1)).toEqual([]);
  });

  it('limita el histórico mensual a once periodos', () => {
    const movements = Array.from({ length: 15 }, (_, i) => five({ fecha_operacion: d(10 - i, 5) })).flat();
    const result = availableWrappeds(movements, now, 1);
    expect(result).toHaveLength(11);
    expect(result.at(-1)?.key).toBe('mes:2025-12');
  });

  it('en enero incluye el año natural anterior, si tiene cinco gastos', () => {
    const result = availableWrappeds(five(), d(1, 3, 2027), 1);
    expect(result.find(p => p.scope === 'anio')).toEqual(annual);
    expect(availableWrappeds(five().slice(1), d(1, 3, 2027), 1)).toEqual([]);
  });

  it('desde el 1 de diciembre incluye el anual parcial con end = now', () => {
    for (const date of [d(12), d(12, 5)]) {
      const period = availableWrappeds(five(), date, 1).find(p => p.scope === 'anio');
      expect(period).toEqual({ ...annual, end: date, parcial: true });
    }
    expect(availableWrappeds(five(), d(11, 30), 1).some(p => p.scope === 'anio')).toBe(false);
  });

  it('usa el periodo anterior real por nómina y periodName, también para comparativa', () => {
    const payroll = [d(8, 28), d(9, 29), d(10, 28)].map(fecha_operacion =>
      expense({ tipo: 'ingreso', concepto: 'Nómina', categoria: 'nomina', importe: 100, fecha_operacion }));
    const movements = [...payroll, ...five(), expense({ fecha_operacion: d(9, 5), importe: 100 })];
    const result = availableWrappeds(movements, now, 'nomina');
    expect(result[0]).toEqual({ scope: 'mes', key: 'mes:2026-09', start: d(9, 29), end: d(10, 28), label: 'oct' });
    const data = build(movements, result[0]);
    expect(data.comparativa?.gastosAnterior).toBe(100);
    expect(data.curiosidades[0]).toBe('Gastaste un 50 % menos que en sep.');
  });

  it('respeta inicio fijo y excluye el periodo todavía abierto', () => {
    const result = availableWrappeds([...five(), ...five({ fecha_operacion: d(10, 29) })], now, 28);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ scope: 'mes', key: 'mes:2026-09', start: d(9, 28), end: d(10, 28), label: 'oct' });
  });
});

describe('featuredWrapped', () => {
  it('anuncia el mensual solo durante los 10 primeros días del periodo nuevo y lo oculta si ya se vio', () => {
    const movements = [...five(), ...five({ fecha_operacion: d(9, 5) })];
    expect(featuredWrapped(movements, d(11, 1), 1)?.key).toBe('mes:2026-10');
    expect(featuredWrapped(movements, d(11, 10), 1)?.key).toBe('mes:2026-10');
    expect(featuredWrapped(movements, d(11, 11), 1)).toBeNull();
    expect(featuredWrapped(movements, d(11, 3), 1, ['mes:2026-10'])).toBeNull();
  });

  it('en enero da prioridad al anual sobre el mensual de diciembre, y pasa al mensual si el anual ya se vio', () => {
    const decExpenses = five({ fecha_operacion: d(12, 10) });
    expect(featuredWrapped(decExpenses, d(1, 3, 2027), 1)?.key).toBe('anio:2026');
    expect(featuredWrapped(decExpenses, d(1, 25, 2027), 1)?.key).toBe('anio:2026');
    expect(featuredWrapped(decExpenses, d(1, 3, 2027), 1, ['anio:2026'])?.key).toBe('mes:2026-12');
    expect(featuredWrapped(decExpenses, d(1, 15, 2027), 1, ['anio:2026'])).toBeNull();
  });

  it('en diciembre anuncia el anual parcial cuando no hay mensual pendiente o tras descartarlo', () => {
    expect(featuredWrapped(five(), d(12, 5), 1)).toMatchObject({ key: 'anio:2026', parcial: true });
    const withNov = [...five(), ...five({ fecha_operacion: d(11, 10) })];
    expect(featuredWrapped(withNov, d(12, 3), 1)?.key).toBe('mes:2026-11');
    expect(featuredWrapped(withNov, d(12, 3), 1, ['mes:2026-11'])).toMatchObject({ key: 'anio:2026', parcial: true });
    expect(featuredWrapped(withNov, d(12, 15), 1)).toMatchObject({ key: 'anio:2026', parcial: true });
  });
});

describe('inventario de tarjetas', () => {
  const card = (id: string, score: number, grupo?: string): WrappedHighlight => ({ id, score, grupo });

  it('elige las más llamativas, una por grupo, y las ordena como una historia', () => {
    const inventario = [
      card('racha', 90, 'sin-gasto'), card('dias-sin-gastar', 85, 'sin-gasto'), card('pequenas', 70, 'pequenas'),
      card('cafes', 65, 'pequenas'), card('comercios', 60), card('primer-gasto', 10),
    ];
    expect(selectHighlights(inventario, 3)).toEqual(['comercios', 'pequenas', 'racha']);
  });

  it('rota: lo que destacó el periodo anterior pierde peso frente a algo nuevo', () => {
    const inventario = [card('racha', 80), card('comercios', 70), card('ticket-medio', 55)];
    expect(selectHighlights(inventario, 2)).toEqual(['comercios', 'racha']);
    // 80 × 0,4 = 32 < 55: la racha deja sitio al ticket medio.
    expect(selectHighlights(inventario, 2, ['racha', 'ritmo'])).toEqual(['comercios', 'ticket-medio']);
  });

  it('detecta cambios frente al mes anterior: categoría que sube, que baja y comercio que desaparece', () => {
    const september = [
      ...Array.from({ length: 4 }, (_, i) => expense({ id: `s${i}`, concepto: 'Bar Pepe', categoria: 'restaurantes', importe: 25, fecha_operacion: d(9, 3 + i * 5) })),
      expense({ id: 's9', concepto: 'Zara', categoria: 'compras', importe: 30, fecha_operacion: d(9, 25) }),
    ];
    const octoberMovs = [
      ...Array.from({ length: 5 }, (_, i) => expense({ id: `o${i}`, concepto: 'Zara', categoria: 'compras', importe: 40, fecha_operacion: d(10, 2 + i * 5) })),
      expense({ id: 'o9', concepto: 'Mercadona', categoria: 'alimentacion', importe: 20, fecha_operacion: d(10, 28) }),
    ];
    const result = build([...september, ...octoberMovs]);
    const ids = result.inventario.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['categoria-sube', 'categoria-baja', 'comercio-ausente']));
    expect(result.inventario.find(c => c.id === 'categoria-baja')).toMatchObject({ titulo: 'Restaurantes' });
    expect(result.inventario.find(c => c.id === 'comercio-ausente')?.detalle).toBe('En septiembre fuiste 4 veces y este mes ninguna.');
    expect(result.destacados.length).toBeLessThanOrEqual(5);
    expect(result.destacados.every(id => ids.includes(id))).toBe(true);
  });

  it('el mismo patrón dos meses seguidos no repite exactamente las mismas tarjetas', () => {
    const month = (m: number) => Array.from({ length: 12 }, (_, i) => expense({
      id: `${m}-${i}`, concepto: i % 3 ? 'Cafetería Luna' : 'Mercadona', categoria: i % 3 ? 'restaurantes' : 'alimentacion',
      importe: i % 3 ? 2.5 : 45, fecha_operacion: d(m, 1 + i * 2),
    }));
    const movements = [...month(9), ...month(10), ...month(11)];
    const nov: WrappedPeriod = { scope: 'mes', key: 'mes:2026-11', label: 'noviembre', start: d(11), end: d(12) };
    const oct = buildWrapped(movements, october, { now: d(12, 2) })!;
    const novData = buildWrapped(movements, nov, { now: d(12, 2) })!;
    expect(oct.inventario.length).toBeGreaterThan(5);
    expect(novData.destacados).not.toEqual(oct.destacados);
  });
});
