import { describe, expect, it } from 'vitest';
import { createIdTokenVerifier } from '../src/idToken.js';

const PROJECT = 'demo-flowt';
const NOW = 1_800_000_000_000;

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encode = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)));

async function setup(allowedUids) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const fetchFn = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'max-age=3600' } });
  const verify = createIdTokenVerifier({ projectId: PROJECT, allowedUids, fetchFn, now: () => NOW });
  const sign = async (sub) => {
    const seconds = NOW / 1000;
    const body = `${encode({ alg: 'RS256', kid: 'k1' })}.${encode({
      aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub, iat: seconds - 10, exp: seconds + 600,
    })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${base64url(signature)}`;
  };
  return { verify, sign };
}

describe('createIdTokenVerifier', () => {
  it('accepts a valid token of an allowed account and rejects any other account', async () => {
    const { verify, sign } = await setup(['owner']);
    await expect(verify(await sign('owner'))).resolves.toBe('owner');
    await expect(verify(await sign('stranger'))).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('accepts any valid account when no allowlist is given', async () => {
    const { verify, sign } = await setup(undefined);
    await expect(verify(await sign('stranger'))).resolves.toBe('stranger');
  });
});
