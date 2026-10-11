import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'u1', getIdToken: async () => 'token' } } }));

import { tryEditReviewedMovement } from './reviewApi';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_REVIEW_API_URL', 'https://api.example/');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('edición a través del servicio de revisión', () => {
  it('sin servicio configurado deja la escritura a quien llama', async () => {
    vi.stubEnv('VITE_REVIEW_API_URL', '');
    expect(await tryEditReviewedMovement('m1', { name: 'Cena' })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usa el servicio cuando responde', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await tryEditReviewedMovement('m1', { name: 'Cena' })).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/api/reviews/edit', expect.objectContaining({ method: 'POST' }));
  });

  it('si el servicio no es alcanzable deja la escritura a quien llama', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await tryEditReviewedMovement('m1', { name: 'Cena' })).toBe(false);
  });

  it('un rechazo del servicio no se convierte en escritura directa', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Conflicto' }) });
    await expect(tryEditReviewedMovement('m1', { name: 'Cena' })).rejects.toThrow('Conflicto');
  });
});
