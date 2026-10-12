import type { Hucha, Movimiento, PendingEmail, Suscripcion } from '../types';
import type { Bank } from '../context/bankContext';
import { estimateBankBalance } from './banks';
import { applySplit, extraMonth, recordedSplit, roundMoney, splitIncome } from './incomeSplit';
import { crearRetiradaEfectivo, cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { parseMovimientoDate } from './periodStats';
import { getEffectiveSubscriptionAmount, getMonthlySubscriptionAmount, getSubscriptionChargeForMonth, toLocalDateKey } from './subscriptions';

export const sortDemoMovements = (movimientos: Movimiento[]): Movimiento[] => [...movimientos].sort((a, b) =>
  (parseMovimientoDate(b.fecha_operacion)?.getTime() ?? 0) - (parseMovimientoDate(a.fecha_operacion)?.getTime() ?? 0));

export function buildDemoData(now: Date) {
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const startDate = (day: number) => toLocalDateKey(new Date(firstMonth.getFullYear(), firstMonth.getMonth(), day));
  const annualRenewal = toLocalDateKey(new Date(firstMonth.getFullYear(), firstMonth.getMonth() - 1, 5));
  const suscripciones: Suscripcion[] = [
    { id: 's-1', nombre: 'Netflix Premium', importe: 17.99, frecuencia: 'mensual', dia_pago: 12, fecha_inicio: startDate(12), categoria: 'streaming', color: '#ef4444', activa: true, hucha_id: 'h-3' },
    { id: 's-2', nombre: 'Spotify Duo', importe: 14.99, mi_parte: 7.50, frecuencia: 'mensual', dia_pago: 20, fecha_inicio: startDate(20), categoria: 'musica', color: '#22c55e', activa: true, hucha_id: 'h-3' },
    { id: 's-3', nombre: 'Amazon Prime', importe: 49.90, frecuencia: 'anual', dia_pago: 5, fecha_inicio: annualRenewal, categoria: 'streaming', color: '#0ea5e9', activa: true, hucha_id: 'h-3' },
    { id: 's-4', nombre: 'Gimnasio', importe: 29.99, frecuencia: 'mensual', dia_pago: 2, fecha_inicio: startDate(2), categoria: 'fitness', color: '#f97316', activa: false },
  ];
  const subscriptionBudget = roundMoney(suscripciones.filter(s => s.activa).reduce((sum, s) => sum + getMonthlySubscriptionAmount(s), 0));
  let huchas: Hucha[] = [
    { id: 'h-1', nombre: 'Día a día', saldo_acumulado: 0, objetivo: null, tipo_aportacion: 'resto', orden: 1, es_principal: true },
    { id: 'h-2', nombre: 'Viaje a Japón', saldo_acumulado: 0, objetivo: 4000, tipo_aportacion: 'porcentaje', valor_aportacion: 10, orden: 2, tope_objetivo: true },
    { id: 'h-3', nombre: 'Suscripciones', saldo_acumulado: 0, objetivo: null, tipo_aportacion: 'flat', valor_aportacion: subscriptionBudget, orden: 3, es_suscripciones: true },
    { id: 'h-4', nombre: 'Ocio', saldo_acumulado: 0, objetivo: null, tipo_aportacion: 'flat', valor_aportacion: 150, orden: 4, extra_importe: 100, extra_meses: [7, 12] },
    { id: 'h-5', nombre: 'Colchón', saldo_acumulado: 0, objetivo: 8000, tipo_aportacion: 'porcentaje', valor_aportacion: 15, orden: 5 },
    { id: 'h-6', nombre: 'Efectivo', saldo_acumulado: 0, objetivo: null, tipo_aportacion: 'flat', valor_aportacion: 0, orden: 6, es_metalico: true },
  ];
  const movimientos: Movimiento[] = [];
  const add = (movement: Movimiento) => {
    if (movement.fecha_operacion <= now) movimientos.push(movement);
  };
  const openingPayroll = new Date(firstMonth.getFullYear(), firstMonth.getMonth() - 1, 28);
  add({ id: 'm-nomina-inicial', tipo: 'ingreso', concepto: `Nómina ${openingPayroll.toLocaleDateString('es-ES', { month: 'long' })}`, categoria: 'nomina', importe: 2150, fecha_operacion: openingPayroll, banco: 'Unicaja' });
  for (let index = 0; index < 6; index++) {
    const month = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1);
    const date = (day: number) => new Date(month.getFullYear(), month.getMonth(), day);
    const prefix = `m-${toLocalDateKey(month).slice(0, 7)}`;
    add({ id: `${prefix}-nomina`, tipo: 'ingreso', concepto: `Nómina ${month.toLocaleDateString('es-ES', { month: 'long' })}`, categoria: 'nomina', importe: 2150, fecha_operacion: date(28), banco: 'Unicaja' });
    const expenses: [number, string, number, string, string?, string?][] = [
      [1, 'Alquiler del piso', 650, 'vivienda'],
      [3, 'Luz Iberdrola', 48.30 + index * 2.15, 'vivienda'],
      [2, 'Supermercado Mercadona', 54.80 + index * 1.25, 'alimentacion'],
      [9, 'Supermercado Lidl', 38.45 + index * 0.65, 'alimentacion'],
      [17, 'Supermercado Mercadona', 62.10 + index * 0.90, 'alimentacion'],
      [25, 'Supermercado Carrefour', 29.60 + index * 1.10, 'alimentacion'],
      [7, 'Restaurante La Plaza', 26.50 + index, 'restaurantes'],
      [16, 'Pizzería del barrio', 19.90 + index * 0.50, 'restaurantes'],
      [24, 'Menú del día', 14.50, 'restaurantes'],
      [4, 'Abono de transporte', 28, 'transporte'],
      [19, 'Compra de ropa', 34.95 + index * 3, 'compras'],
      [11, 'Entradas de cine', 18, 'ocio', 'h-4'],
      [22, 'Concierto con amigos', 35 + index * 2, 'ocio', 'h-4', 'Revolut'],
      [15, 'Farmacia', 12.60 + index * 0.30, 'salud'],
    ];
    expenses.forEach(([day, concepto, importe, categoria, hucha_id = 'h-1', banco = 'Unicaja'], i) => {
      add({ id: `${prefix}-gasto-${i}`, tipo: 'gasto', concepto, importe: roundMoney(importe), categoria, hucha_id, banco, fecha_operacion: date(day) });
    });
    [1, 5, 8, 10, 14, 18, 23, 27].forEach((day, i) => {
      add({ id: `${prefix}-pequeno-${i}`, tipo: 'gasto', concepto: i % 2 ? 'Panadería del barrio' : 'Café para llevar', importe: roundMoney(1.40 + ((index + i) % 7) * 0.35), categoria: i % 2 ? 'alimentacion' : 'restaurantes', hucha_id: 'h-1', banco: 'Unicaja', fecha_operacion: date(day) });
    });
    for (const subscription of suscripciones.filter(s => s.activa)) {
      const charge = getSubscriptionChargeForMonth(subscription, month.getFullYear(), month.getMonth(), now);
      if (charge) add({ id: `${prefix}-${subscription.id}`, tipo: 'gasto', concepto: subscription.nombre, importe: getEffectiveSubscriptionAmount(subscription), categoria: 'ocio', hucha_id: 'h-3', suscripcion_id: subscription.id, banco: 'Unicaja', fecha_operacion: charge });
    }
  }

  const historicalDate = (monthOffset: number, day: number) => new Date(firstMonth.getFullYear(), firstMonth.getMonth() + monthOffset, day);
  add({ id: 'm-compartido', tipo: 'gasto', concepto: 'Cena compartida con amigos', importe: 45, importe_neto: 22.50, categoria: 'restaurantes', hucha_id: 'h-1', compensado_por: ['m-bizum'], fecha_operacion: historicalDate(3, 15) });
  add({ id: 'm-bizum', tipo: 'ingreso', concepto: 'Bizum: Cena de ayer (compensación)', importe: 22.50, categoria: 'reembolsos', hucha_id: 'h-1', compensa_movimiento_id: 'm-compartido', banco: 'Unicaja', fecha_operacion: historicalDate(3, 16) });
  add({ id: 'm-venta', tipo: 'ingreso', concepto: 'Venta de una bicicleta en Wallapop', importe: 120, categoria: 'ventas', hucha_id: 'h-1', fecha_operacion: historicalDate(2, 18) });
  const withdrawal = crearRetiradaEfectivo({ gasto_id: 'm-retirada-salida', ingreso_id: 'm-retirada-entrada', transfer_id: 'demo-retirada', concepto: 'Cajero del barrio', importe: 60, fecha_operacion: historicalDate(4, 6), hucha_origen_id: 'h-1', hucha_efectivo_id: 'h-6' });
  withdrawal.forEach(add);
  add({ id: 'm-efectivo', tipo: 'gasto', concepto: 'Compra en el mercado en efectivo', importe: 18.50, categoria: 'alimentacion', hucha_id: 'h-6', es_metalico: true, fecha_operacion: historicalDate(4, 8) });
  add({ id: 'm-manual', tipo: 'gasto', concepto: 'Libro de segunda mano', importe: 9, categoria: 'compras', hucha_id: 'h-1', fecha_operacion: historicalDate(4, 10) });
  const duplicateDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 18, 30);
  [0, 1].forEach(index => add({ id: `m-duplicado-${index}`, tipo: 'gasto', concepto: 'Restaurante El Olivo', importe: 23.80, categoria: 'restaurantes', hucha_id: 'h-1', banco: 'Unicaja', fecha_operacion: new Date(duplicateDate.getTime() + index * 3 * 60_000) }));

  // Replay the ledger chronologically, including internal cash transfers and refunds.
  const sorted = sortDemoMovements(movimientos);
  for (const movement of [...sorted].reverse()) {
    if (movement.tipo === 'ingreso' && !movement.hucha_id) {
      const split = splitIncome(movement.importe, huchas, { extraMonth: extraMonth(movement) });
      movement.reparto_aplicado = recordedSplit(split);
      huchas = applySplit(huchas, split);
    } else {
      const delta = movement.tipo === 'ingreso' ? movement.importe : -movement.importe;
      huchas = huchas.map(h => h.id === movement.hucha_id ? { ...h, saldo_acumulado: roundMoney(h.saldo_acumulado + delta) } : h);
    }
  }
  const stats = { total_ingresos: 0, total_gastos: 0 };
  for (const movement of sorted) {
    if (!cuentaEnEstadisticas(movement)) continue;
    const key = movement.tipo === 'ingreso' ? 'total_ingresos' : 'total_gastos';
    stats[key] = roundMoney(stats[key] + importeEnEstadisticas(movement));
  }
  const unicaja: Bank = { id: 'unicaja', nombre: 'Unicaja', anclaSaldo: 0, anclaFecha: new Date(now.getFullYear(), now.getMonth(), 1), ultimoDesfase: null };
  const bankWalletsTotal = roundMoney(huchas.filter(h => !h.es_metalico).reduce((sum, h) => sum + h.saldo_acumulado, 0));
  unicaja.anclaSaldo = roundMoney(bankWalletsTotal - estimateBankBalance(unicaja, sorted)!);
  const bancos: Bank[] = [unicaja, { id: 'revolut', nombre: 'Revolut', anclaFecha: null, ultimoDesfase: null }];

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(today);
  monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
  const pending: PendingEmail[] = [0, 1].map(index => {
    const candidate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (1 - index));
    const date = new Date(Math.max(monday.getTime(), candidate.getTime()));
    const label = date.toLocaleDateString('es-ES');
    return {
      id: `pend-${index + 1}`, email_id: `gmail-${101 + index}`, banco: 'Unicaja',
      cuerpo: index === 0
        ? `Asunto: Notificación de cargo\nEstimado cliente,\nLe informamos de un cargo de 24,99 EUR en su tarjeta con fecha ${label} en el comercio DISCORD*NITRO.\nGracias por su confianza.`
        : `Asunto: Abono recibido\n¡Hola! Te enviaron un Bizum de 12,00 EUR el ${label}. Concepto: Cena de ayer.\n¡Que tengas un buen día!`,
      fecha_envio: date.toISOString(), motivo: 'Fallo total en extracción automática', procesado: false, created_at: date,
    };
  });
  return { huchas, suscripciones, movimientos: sorted, pending, bancos, stats };
}
