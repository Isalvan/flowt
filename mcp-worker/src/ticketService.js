import categories from '../../tracker-backend/prompts/categories.json';
import schema from '../../tracker-backend/prompts/ticket_schema.json';
import { FlowtError } from './errors.js';
import { NOT_A_TICKET, sanitizeTicket } from './ticketDomain.js';
import { TICKET_PROMPT } from './ticketPrompt.js';

export const MAX_TICKET_BODY = 2 * 1024 * 1024;
export const TICKET_RATE_LIMIT = 10;
const INVALID_IMAGE = 'Envía una imagen base64 sin prefijo y un mime image/jpeg, image/png o image/webp.';

export function validateTicketImage(body) {
  const image = body?.image;
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || !['image/jpeg', 'image/png', 'image/webp'].includes(body.mime)
      || typeof image !== 'string' || !image.length || image.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new FlowtError('invalid_arguments', INVALID_IMAGE);
  return { image, mime: body.mime };
}

/** Read at most the route's byte limit, even without a Content-Length header. */
export async function readTicketBody(request) {
  const tooLarge = () => new FlowtError('payload_too_large', 'Petición demasiado grande');
  if (Number(request.headers.get('Content-Length')) > MAX_TICKET_BODY) throw tooLarge();
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_TICKET_BODY) {
          await reader.cancel();
          throw tooLarge();
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { body = null; }
  return validateTicketImage(body);
}

export async function scanTicket(body, env, { fetch: fetcher = fetch, today } = {}) {
  if (!env.GEMINI_API_KEY) throw new FlowtError('not_configured', 'El escaneo de tickets no está configurado');
  const model = env.TICKET_AI_MODEL || 'gemini-3.5-flash';
  const catalog = categories.filter((c) => ['gasto', 'ambos'].includes(c.tipo)).map((c) => c.id).join(', ');
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ contents: [{ role: 'user', parts: [
      { text: `${TICKET_PROMPT}\nCatálogo de gastos: ${catalog}.` },
      { inlineData: { mimeType: body.mime, data: body.image } },
    ] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 } }),
  });
  if (!response.ok) throw new FlowtError('retryable_error', 'No se pudo completar la operación');
  let result;
  try { result = await response.json(); } catch { throw new FlowtError('not_a_ticket', NOT_A_TICKET); }
  const candidate = result?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new FlowtError('not_a_ticket', NOT_A_TICKET);
  const parts = candidate?.content?.parts;
  const raw = Array.isArray(parts) ? parts.filter((p) => !p?.thought && typeof p?.text === 'string').map((p) => p.text).join('') : null;
  return sanitizeTicket(raw, today);
}
