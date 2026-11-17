import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '../firebase';
import { DEMO_TICKET } from './demoData';
import { scanTicket } from './ticketApi';

const token = vi.fn(async () => 'firebase-token');
beforeEach(() => {
  vi.stubEnv('VITE_REVIEW_API_URL', 'https://flowt.example/');
  Object.defineProperty(auth, 'currentUser', { configurable: true, value: { uid: 'owner', getIdToken: token } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('scanTicket', () => {
  it('sends the fixed API contract with a Firebase token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(DEMO_TICKET)));
    vi.stubGlobal('fetch', fetch);
    expect(await scanTicket('base64photo', 'image/jpeg')).toEqual(DEMO_TICKET);
    expect(fetch).toHaveBeenCalledWith('https://flowt.example/api/tickets/scan', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer firebase-token' }, body: '{"image":"base64photo","mime":"image/jpeg"}' }));
  });
  it.each([401, 413, 429, 503])('explains HTTP %s errors', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'failed' }), { status })));
    await expect(scanTicket('photo', 'image/jpeg')).rejects.toThrow();
  });
  it('preserves the 422 message and rejects malformed successful responses', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not_a_ticket', message: 'Prueba con más luz' }), { status: 422 }))
      .mockResolvedValueOnce(new Response('{"unexpected":true}'));
    vi.stubGlobal('fetch', fetch);
    await expect(scanTicket('photo', 'image/jpeg')).rejects.toThrow('Prueba con más luz');
    await expect(scanTicket('photo', 'image/jpeg')).rejects.toThrow('No he podido leer');
  });
  it('requires authentication and rejects a changed session', async () => {
    Object.defineProperty(auth, 'currentUser', { configurable: true, value: null });
    await expect(scanTicket('photo', 'image/jpeg')).rejects.toThrow('Inicia sesión');
    Object.defineProperty(auth, 'currentUser', { configurable: true, value: { uid: 'owner', getIdToken: async () => {
      Object.defineProperty(auth, 'currentUser', { configurable: true, value: { uid: 'other' } });
      return 'token';
    } } });
    await expect(scanTicket('photo', 'image/jpeg')).rejects.toThrow('sesión ha cambiado');
  });
});
