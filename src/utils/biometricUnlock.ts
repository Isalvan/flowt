const storageKey = (uid: string | null) => `flowt:biometric:${uid ?? 'demo'}`;

function savedCredential(uid: string | null): string | null {
  try {
    return localStorage.getItem(storageKey(uid));
  } catch {
    return null;
  }
}

function encode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

export async function biometricAvailable(): Promise<boolean> {
  try {
    return Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials &&
      await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export function biometricEnabled(uid: string | null): boolean {
  return Boolean(savedCredential(uid));
}

export async function enableBiometric(uid: string | null): Promise<boolean> {
  try {
    const credential = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Flowt' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Flowt', displayName: 'Flowt' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none', timeout: 60000,
    } }) as PublicKeyCredential | null;
    if (!credential) return false;
    localStorage.setItem(storageKey(uid), encode(credential.rawId));
    return true;
  } catch {
    return false;
  }
}

export function disableBiometric(uid: string | null): void {
  try {
    localStorage.removeItem(storageKey(uid));
  } catch {
    // Storage may be unavailable on this device.
  }
}

export async function verifyBiometric(uid: string | null): Promise<boolean> {
  try {
    const saved = savedCredential(uid);
    if (!saved) return false;
    const credential = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: decode(saved), transports: ['internal'] }],
      userVerification: 'required', timeout: 60000,
    } }) as PublicKeyCredential | null;
    if (!credential || encode(credential.rawId) !== saved) return false;
    const data = new Uint8Array((credential.response as AuthenticatorAssertionResponse).authenticatorData);
    // This local screen lock has no server to verify the signature.
    return data.length > 32 && (data[32] & 0x05) === 0x05;
  } catch {
    return false;
  }
}
