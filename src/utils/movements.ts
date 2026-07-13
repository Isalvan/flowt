import { type Movimiento } from '../types';

export const esMovimientoInterno = (movimiento: Pick<Movimiento, 'es_interno'>): boolean =>
  movimiento.es_interno === true;

export const cuentaEnEstadisticas = (movimiento: Pick<Movimiento, 'es_interno'>): boolean =>
  !esMovimientoInterno(movimiento);