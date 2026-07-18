import { type Movimiento } from '../types';

export const esMovimientoInterno = (movimiento: Pick<Movimiento, 'es_interno'>): boolean =>
  movimiento.es_interno === true;

export const cuentaEnEstadisticas = (movimiento: Pick<Movimiento, 'es_interno'>): boolean =>
  !esMovimientoInterno(movimiento);

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
