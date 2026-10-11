/**
 * Google access tokens for a service account, with Web Crypto only (no Node libraries),
 * so it runs in Cloudflare Workers. Same approach as the Zenith worker.
 */

function pemToBinary(pem) {
  const raw = atob(pem.replace(/-----[^\n]+-----/g, '').replace(/\s+/g, ''));
  const buffer = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) buffer[index] = raw.charCodeAt(index);
  return buffer.buffer;
}

function base64Url(data) {
  const text = typeof data === 'string' ? data : String.fromCharCode(...new Uint8Array(data));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class GoogleAuthClient {
  /**
   * @param {{ client_email: string, private_key: string }} serviceAccount
   * @param {typeof fetch} [fetchFn]
   */
  constructor(serviceAccount, fetchFn = (...args) => fetch(...args)) {
    this.serviceAccount = serviceAccount;
    this.fetch = fetchFn;
    this.token = null;
    this.expiry = 0;
  }

  async getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    // Reuse the token while it has more than five minutes left.
    if (this.token && this.expiry > now + 300) return this.token;
    const key = await crypto.subtle.importKey('pkcs8', pemToBinary(this.serviceAccount.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(JSON.stringify({ iss: this.serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now }));
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${base64Url(signature)}` }),
    });
    if (!response.ok) throw new Error(`Google token request failed (${response.status})`);
    const data = await response.json();
    this.token = data.access_token;
    this.expiry = now + (data.expires_in || 3600);
    return this.token;
  }
}
