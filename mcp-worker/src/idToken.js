/**
 * Verifies Firebase ID tokens (the web app's session) without the Admin SDK:
 * signature against Google's published keys, then issuer, audience and times.
 *
 * Unlike the Admin SDK's check_revoked, a token of a session revoked in Firebase
 * stays valid until it expires (at most one hour).
 */
import { FlowtError } from './errors.js';

const KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const SKEW_SECONDS = 300;

function decodePart(part) {
  const text = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/**
 * @param {{ projectId: string, fetchFn?: typeof fetch, now?: () => number }} options
 * @returns {(token: string) => Promise<string>} resolves to the user id, rejects with FlowtError('unauthorized')
 */
export function createIdTokenVerifier({ projectId, fetchFn = (...args) => fetch(...args), now = () => Date.now() }) {
  let keys = new Map();
  let expires = 0;
  let fetchedAt = 0;

  async function loadKeys() {
    const response = await fetchFn(KEYS_URL);
    if (!response.ok) throw new Error(`Could not load Firebase signing keys (${response.status})`);
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control') || '')?.[1] || 3600);
    const { keys: list } = await response.json();
    keys = new Map(list.map((jwk) => [jwk.kid, jwk]));
    fetchedAt = now();
    expires = fetchedAt + maxAge * 1000;
  }

  async function keyFor(kid) {
    if (now() >= expires) await loadKeys();
    // An unknown key id may mean Google rotated its keys since the last fetch.
    if (!keys.has(kid) && now() - fetchedAt > 60_000) await loadKeys();
    const jwk = keys.get(kid);
    return jwk ? crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) : null;
  }

  return async function verifyIdToken(token) {
    const denied = () => new FlowtError('unauthorized', 'Credenciales no válidas');
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw denied();
    let header;
    let claims;
    let signature;
    try {
      header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
      claims = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
      signature = decodePart(parts[2]);
    } catch {
      throw denied();
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw denied();
    const key = await keyFor(header.kid);
    if (!key || !(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))) throw denied();
    const seconds = now() / 1000;
    const valid = claims.aud === projectId && claims.iss === `https://securetoken.google.com/${projectId}`
      && typeof claims.sub === 'string' && claims.sub.length > 0 && claims.sub.length <= 128
      && typeof claims.exp === 'number' && claims.exp > seconds
      && typeof claims.iat === 'number' && claims.iat <= seconds + SKEW_SECONDS
      && (claims.auth_time === undefined || claims.auth_time <= seconds + SKEW_SECONDS);
    if (!valid) throw denied();
    return claims.sub;
  };
}
