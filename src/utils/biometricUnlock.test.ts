import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { biometricAvailable, biometricEnabled, disableBiometric, enableBiometric, verifyBiometric } from './biometricUnlock';

const available = vi.fn();
const create = vi.fn();
const get = vi.fn();
const rawId = new Uint8Array([251, 255, 1]).buffer;
const assertion = (flags = 5, id = rawId) => {
  const data = new Uint8Array(37);
  data[32] = flags;
  return { rawId: id, response: { authenticatorData: data.buffer } };
};

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: available });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create, get } });
  available.mockResolvedValue(true);
  create.mockResolvedValue({ rawId });
  get.mockResolvedValue(assertion());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'credentials'); });

describe('biometric unlock', () => {
  it('requires a secure context, credentials and an available platform authenticator', async () => {
    expect(await biometricAvailable()).toBe(true);
    available.mockResolvedValue(false);
    expect(await biometricAvailable()).toBe(false);
    available.mockRejectedValue(new Error('Unavailable'));
    expect(await biometricAvailable()).toBe(false);
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(await biometricAvailable()).toBe(false);
    vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: available });
    vi.stubGlobal('isSecureContext', false);
    expect(await biometricAvailable()).toBe(false);
    vi.stubGlobal('isSecureContext', true);
    Reflect.deleteProperty(navigator, 'credentials');
    expect(await biometricAvailable()).toBe(false);
  });

  it('stores only a base64url ID per user and uses anonymous registration options', async () => {
    expect(await enableBiometric('a')).toBe(true);
    expect(localStorage.getItem('flowt:biometric:a')).toBe('-_8B');
    expect(biometricEnabled('a')).toBe(true);
    expect(biometricEnabled('b')).toBe(false);
    expect(await enableBiometric(null)).toBe(true);
    expect(biometricEnabled(null)).toBe(true);
    const options = create.mock.calls[0][0].publicKey;
    expect(options).toMatchObject({ rp: { name: 'Flowt' }, user: { name: 'Flowt', displayName: 'Flowt' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none', timeout: 60000 });
    expect(options.rp).not.toHaveProperty('id');
    expect(options.challenge.byteLength).toBe(32);
    expect(options.user.id.byteLength).toBe(16);
    disableBiometric('a');
    expect(localStorage.getItem('flowt:biometric:a')).toBeNull();
    expect(biometricEnabled(null)).toBe(true);
  });

  it('does not store a credential after cancellation or a null result', async () => {
    create.mockRejectedValue(new DOMException('Cancelled', 'NotAllowedError'));
    expect(await enableBiometric('a')).toBe(false);
    create.mockResolvedValue(null);
    expect(await enableBiometric('a')).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('requires the saved ID and both user presence and verification flags', async () => {
    expect(await verifyBiometric('a')).toBe(false);
    expect(get).not.toHaveBeenCalled();
    await enableBiometric('a');
    expect(await verifyBiometric('a')).toBe(true);
    const options = get.mock.calls[0][0].publicKey;
    expect(options).toMatchObject({ allowCredentials: [{ type: 'public-key', transports: ['internal'] }], userVerification: 'required', timeout: 60000 });
    expect(Array.from(options.allowCredentials[0].id)).toEqual([251, 255, 1]);
    expect(options.challenge.byteLength).toBe(32);
    for (const result of [assertion(1), assertion(4), assertion(5, new Uint8Array([2]).buffer), null,
      { rawId, response: { authenticatorData: new Uint8Array(32).buffer } }]) {
      get.mockResolvedValue(result);
      expect(await verifyBiometric('a')).toBe(false);
    }
    get.mockRejectedValue(new Error('Timed out'));
    expect(await verifyBiometric('a')).toBe(false);
  });

  it('handles inaccessible storage and malformed IDs', async () => {
    localStorage.setItem('flowt:biometric:a', '!');
    expect(await verifyBiometric('a')).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(biometricEnabled('a')).toBe(false);
    expect(await verifyBiometric('a')).toBe(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(await enableBiometric('a')).toBe(false);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(() => disableBiometric('a')).not.toThrow();
  });
});
