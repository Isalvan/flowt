import { auth } from '../firebase';
import type { TicketScanResult } from '../types';
import { validCategory } from './movementSuggestions';

export const hasTicketApi = () => !!import.meta.env.VITE_REVIEW_API_URL;

const errorMessages: Record<number, string> = {
  401: 'Inicia sesión de nuevo para leer el ticket.',
  413: 'La foto ocupa demasiado. Prueba a recortar el ticket y vuelve a intentarlo.',
  422: 'No he podido leer el ticket. Prueba con más luz y el ticket entero.',
  429: 'Has leído muchos tickets. Espera un minuto y vuelve a intentarlo.',
  503: 'La lectura de tickets no está disponible ahora. Puedes escribirlo a mano.',
};

function validResult(value: unknown): value is TicketScanResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as TicketScanResult;
  return typeof v.comercio === 'string' && v.comercio.length <= 120 &&
    (v.fecha === null || (typeof v.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.fecha))) &&
    typeof v.total === 'number' && Number.isFinite(v.total) && v.total > 0 && v.total <= 10000 &&
    typeof v.moneda === 'string' && /^[A-Z]{3}$/.test(v.moneda) &&
    typeof v.categoria_sugerida === 'string' && validCategory(v.categoria_sugerida, 'gasto') &&
    typeof v.cuadra === 'boolean' && Number.isFinite(v.diferencia) &&
    Array.isArray(v.lineas) && v.lineas.length <= 150 && v.lineas.every(l => l &&
      typeof l.descripcion === 'string' && l.descripcion.length <= 120 &&
      typeof l.importe === 'number' && Number.isFinite(l.importe) &&
      typeof l.cantidad === 'number' && Number.isFinite(l.cantidad));
}

export async function scanTicket(image: string, mime: 'image/jpeg', signal?: AbortSignal): Promise<TicketScanResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('Inicia sesión para leer el ticket.');
  const owner = user.uid;
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== owner) throw new Error('La sesión ha cambiado.');
  const body = JSON.stringify({ image, mime });
  if (new Blob([body]).size > 2 * 1024 * 1024) throw new Error(errorMessages[413]);
  const base = String(import.meta.env.VITE_REVIEW_API_URL).replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/api/tickets/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body, signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('No se pudo contactar con el servicio. Comprueba tu conexión y reinténtalo.');
  }
  const result: unknown = await response.json().catch(() => null);
  if (auth.currentUser?.uid !== owner) throw new Error('La sesión ha cambiado.');
  if (!response.ok) {
    const message = response.status === 422 && result && typeof result === 'object' && 'message' in result && typeof result.message === 'string' ? result.message : errorMessages[response.status];
    throw new Error(message || 'No se ha podido leer el ticket. Inténtalo de nuevo.');
  }
  if (!validResult(result)) throw new Error(errorMessages[422]);
  return result;
}
