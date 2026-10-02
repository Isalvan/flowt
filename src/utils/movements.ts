import { type Movimiento } from '../types';

export const esMovimientoInterno = (movimiento: Pick<Movimiento, 'es_interno'>): boolean =>
  movimiento.es_interno === true;

export const cuentaEnEstadisticas = (
  movimiento: Partial<Pick<Movimiento, 'importe' | 'tipo' | 'es_interno' | 'transfer_id' | 'compensa_movimiento_id' | 'compensado_por' | 'compensaciones_destinos' | 'compensado_por_detalles'>>,
): boolean =>
  !esMovimientoInterno(movimiento) &&
  !movimiento.transfer_id &&
  !(movimiento.tipo === 'ingreso' && (movimiento.compensa_movimiento_id || (movimiento.compensaciones_destinos?.length && (movimiento.importe ?? 0) <= movimiento.compensaciones_destinos.reduce((s, d) => s + d.importe, 0) + 0.00001)));

/** Un reembolso reduce el gasto; solo el ingreso no asignado cuenta como ingreso. */
export const importeEnEstadisticas = (m: Movimiento): number => {
  if (m.tipo === 'ingreso') {
    if (m.compensa_movimiento_id) return 0;
    return Math.max(0, Math.round((m.importe - (m.compensaciones_destinos ?? []).reduce((s, d) => s + d.importe, 0)) * 100) / 100);
  }
  return m.importe_neto ?? Math.max(0, Math.round((m.importe - (m.compensado_por_detalles ?? []).reduce((s, d) => s + d.importe, 0)) * 100) / 100);
};

export interface RetiradaEfectivoInput {
  gasto_id: string;
  ingreso_id: string;
  transfer_id: string;
  concepto: string;
  importe: number;
  fecha_operacion: Movimiento['fecha_operacion'];
  hucha_origen_id: string;
  hucha_efectivo_id: string;
}

/**
 * Una retirada de cajero no es un ingreso ni un gasto externo: mueve saldo de
 * una cartera bancaria a Efectivo. Las dos patas deben crearse juntas.
 */
export const crearRetiradaEfectivo = ({
  gasto_id,
  ingreso_id,
  transfer_id,
  concepto,
  importe,
  fecha_operacion,
  hucha_origen_id,
  hucha_efectivo_id,
}: RetiradaEfectivoInput): [Movimiento, Movimiento] => [
  {
    id: gasto_id,
    tipo: 'gasto',
    concepto: `Retirada de efectivo: ${concepto}`,
    importe,
    fecha_operacion,
    hucha_id: hucha_origen_id,
    es_interno: true,
    transfer_id,
  },
  {
    id: ingreso_id,
    tipo: 'ingreso',
    concepto: `Entrada en efectivo: ${concepto}`,
    importe,
    fecha_operacion,
    hucha_id: hucha_efectivo_id,
    es_metalico: true,
    es_interno: true,
    transfer_id,
  },
];
