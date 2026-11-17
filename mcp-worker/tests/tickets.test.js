// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import cases from '../../tracker-backend/finance/ticket_cases.json';
import { createWorker } from '../src/worker.js';
import { MAX_TICKET_BODY } from '../src/ticketService.js';
import { NOT_A_TICKET } from '../src/ticketDomain.js';
import { MemoryDb } from './memoryDb.js';
import { APP, BASE, WEB, verifyIdToken } from './harness.js';

let worker, fetcher, env, clock, db;
const input = { image: 'aW1hZ2U=', mime: 'image/jpeg' };
const output = (text = JSON.stringify(cases[0].entrada)) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });

beforeEach(() => {
  clock = new Date('2026-11-17T12:00:00Z');
  db = new MemoryDb();
  fetcher = vi.fn(async () => Response.json(output()));
  worker = createWorker({ db, verifyIdToken, fetch: fetcher, now: () => clock });
  env = { APP_URL: APP, GEMINI_API_KEY: 'test-key' };
});

async function send({ json = input, body, headers = WEB, method = 'POST', path = '/api/tickets/scan' } = {}) {
  const response = await worker.fetch(new Request(`${BASE}${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(['GET', 'OPTIONS'].includes(method) ? {} : { body: body ?? JSON.stringify(json) }),
  }), env);
  return { status: response.status, headers: response.headers, data: response.status === 204 ? null : await response.json() };
}

describe('POST /api/tickets/scan', () => {
  it('returns the sanitized contract and calls Gemini with an image and schema without persisting it', async () => {
    const before = db.snapshotAll();
    const response = await send();
    expect(response.status).toBe(200);
    expect(response.data).toEqual(cases[0].esperado);
    expect(db.snapshotAll()).toEqual(before);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const request = JSON.parse(init.body);
    expect(request.contents[0].parts[1]).toEqual({ inlineData: { mimeType: input.mime, data: input.image } });
    expect(request.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } });
    expect(request.contents[0].parts[0].text).toContain('alimentacion');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('uses TICKET_AI_MODEL', async () => {
    env.TICKET_AI_MODEL = 'custom-model';
    await send();
    expect(fetcher.mock.calls[0][0]).toContain('/custom-model:generateContent');
  });

  it.each([{}, { Authorization: 'Bearer invalid' }, { Authorization: 'Bearer flowt_pilot' }])('requires a Firebase session: %o', async (headers) => {
    expect((await send({ headers })).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks CORS and accepts preflight without auth', async () => {
    expect((await send({ headers: { Origin: 'https://stranger.example' } })).status).toBe(403);
    expect((await send({ headers: { Origin: APP }, method: 'OPTIONS' })).status).toBe(204);
    expect((await send({ method: 'GET' })).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows images over 64 KB, only on this route', async () => {
    expect((await send({ json: { ...input, image: 'a'.repeat(100_000) } })).status).toBe(200);
    expect((await send({ path: '/mcp', json: { pad: 'a'.repeat(100_000) } })).status).toBe(413);
  });

  it.each([false, true])('rejects a body over 2 MB (Content-Length: %s)', async (withLength) => {
    const body = JSON.stringify({ ...input, image: 'a'.repeat(MAX_TICKET_BODY) });
    const response = await send({ body, headers: { ...WEB, ...(withLength ? { 'Content-Length': String(body.length) } : {}) } });
    expect(response.status).toBe(413);
    expect(response.data).toEqual({ error: 'payload_too_large', message: 'Petición demasiado grande' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes rather than characters', async () => {
    expect((await send({ json: { ...input, extra: 'é'.repeat(MAX_TICKET_BODY / 2) } })).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([null, {}, [], { ...input, mime: 'image/gif' }, { ...input, image: 'data:image/jpeg;base64,aW1hZ2U=' },
    { ...input, image: 'not base64' }, { ...input, image: '' }, { ...input, image: 'a===' }])('rejects invalid image input %o', async (json) => {
    const response = await send({ json });
    expect(response.status).toBe(400);
    expect(response.data.error).toBe('invalid_arguments');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    expect((await send({ body: '{bad json' })).status).toBe(400);
  });

  it('reports missing configuration explicitly', async () => {
    delete env.GEMINI_API_KEY;
    const response = await send();
    expect(response.status).toBe(503);
    expect(response.data).toEqual({ error: 'not_configured', message: 'El escaneo de tickets no está configurado' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['garbage', 'null', '{}', '[]'])('rejects unreadable model output: %s', async (raw) => {
    fetcher.mockResolvedValueOnce(Response.json(output(raw)));
    const response = await send();
    expect(response.status).toBe(422);
    expect(response.data).toEqual({ error: 'not_a_ticket', message: NOT_A_TICKET });
  });

  it.each([{}, { candidates: [] }, { candidates: [{ finishReason: 'MAX_TOKENS' }] },
    { candidates: [{ content: { parts: [null, {}] } }] }])('rejects missing or truncated content', async (raw) => {
    fetcher.mockResolvedValueOnce(Response.json(raw));
    expect((await send()).status).toBe(422);
  });

  it('sanitizes amounts, dates and categories through the endpoint', async () => {
    const entry = cases.find((c) => c.nombre.startsWith('redondeo'));
    fetcher.mockResolvedValueOnce(Response.json(output(JSON.stringify({ ...entry.entrada, fecha: '2099-01-01', categoria_sugerida: 'nomina' }))));
    expect((await send()).data).toEqual({ ...entry.esperado, fecha: null, categoria_sugerida: 'sin_categorizar' });
  });

  it('limits each uid to ten attempts per minute and resets the window', async () => {
    for (let i = 0; i < 10; i++) expect((await send()).status).toBe(200);
    const response = await send();
    expect(response.status).toBe(429);
    expect(response.data).toEqual({ error: 'rate_limited', message: 'Has alcanzado el límite de 10 escaneos por minuto' });
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect((await send({ headers: { ...WEB, Authorization: 'Bearer firebase-other' } })).status).toBe(200);
    clock = new Date(clock.getTime() + 60_000);
    expect((await send()).status).toBe(200);
  });

  it('does not echo or log provider errors or the image', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fetcher.mockRejectedValueOnce(new Error(input.image));
      const response = await send();
      expect(response.status).toBe(503);
      expect(response.data).toEqual({ error: 'retryable_error', message: 'No se pudo completar la operación' });
      expect(JSON.stringify(logger.mock.calls)).not.toContain(input.image);
      fetcher.mockResolvedValueOnce(new Response(input.image, { status: 429 }));
      expect((await send()).status).toBe(503);
    } finally { logger.mockRestore(); }
  });
});
