import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyProvider, usePrivacy } from './PrivacyContext';
import * as biometrics from '../utils/biometricUnlock';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(), setDoc: vi.fn(),
  authCallback: null as null | ((user: { uid: string } | null) => void),
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, callback) => {
    mocks.authCallback = callback;
    callback({ uid: 'user-1' });
    return vi.fn();
  }),
  GoogleAuthProvider: vi.fn(), signInWithPopup: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: mocks.getDoc, setDoc: mocks.setDoc }));
vi.mock('../utils/biometricUnlock', () => ({
  biometricAvailable: vi.fn(), biometricEnabled: vi.fn(), enableBiometric: vi.fn(),
  disableBiometric: vi.fn(), verifyBiometric: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ pin_hash: 'hash' }) });
  vi.mocked(biometrics.biometricAvailable).mockResolvedValue(true);
  vi.mocked(biometrics.biometricEnabled).mockReturnValue(true);
  vi.mocked(biometrics.verifyBiometric).mockResolvedValue(false);
});
afterEach(cleanup);

async function setup() {
  const hook = renderHook(usePrivacy, { wrapper: ({ children }) => <StrictMode><PrivacyProvider>{children}</PrivacyProvider></StrictMode> });
  await waitFor(() => expect(hook.result.current.hasPin).toBe(true));
  await act(async () => {});
  return hook;
}

describe('privacy biometrics', () => {
  it('automatically tries once, even in StrictMode, and does not show PIN on failure', async () => {
    const { result } = await setup();
    expect(biometrics.verifyBiometric).toHaveBeenCalledTimes(1);
    expect(result.current.isLocked).toBe(true);
    expect(result.current.isPinModalOpen).toBe(false);
    act(() => result.current.lock());
    await act(async () => {});
    expect(biometrics.verifyBiometric).toHaveBeenCalledTimes(1);
  });

  it('unlocks automatically and does not repeat after a manual lock', async () => {
    vi.mocked(biometrics.verifyBiometric).mockResolvedValue(true);
    const { result } = await setup();
    expect(result.current.isLocked).toBe(false);
    act(() => result.current.lock());
    await act(async () => {});
    expect(result.current.isLocked).toBe(true);
    expect(biometrics.verifyBiometric).toHaveBeenCalledTimes(1);
  });

  it('unlocks without the modal and reports success to the callback', async () => {
    const { result } = await setup();
    vi.mocked(biometrics.verifyBiometric).mockResolvedValue(true);
    const callback = vi.fn();
    await act(async () => result.current.openUnlockModal(callback));
    expect(result.current.isLocked).toBe(false);
    expect(result.current.isPinModalOpen).toBe(false);
    expect(callback).toHaveBeenCalledWith(true);
  });

  it('falls back to PIN and preserves the callback, while pinOnly bypasses biometrics', async () => {
    const { result } = await setup();
    const callback = vi.fn();
    await act(async () => result.current.openUnlockModal(callback));
    expect(result.current.isPinModalOpen).toBe(true);
    expect(result.current.pinModalMode).toBe('enter');
    expect(result.current.pinCallback).toBe(callback);
    act(() => result.current.closePinModal());
    vi.mocked(biometrics.verifyBiometric).mockClear();
    act(() => result.current.openUnlockModal(undefined, { pinOnly: true }));
    expect(result.current.isPinModalOpen).toBe(true);
    expect(biometrics.verifyBiometric).not.toHaveBeenCalled();
  });

  it('shares a pending request and ignores success after selecting PIN', async () => {
    let resolve!: (success: boolean) => void;
    vi.mocked(biometrics.verifyBiometric).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result } = await setup();
    act(() => { result.current.openUnlockModal(); result.current.openUnlockModal(); });
    expect(biometrics.verifyBiometric).toHaveBeenCalledTimes(1);
    act(() => result.current.openUnlockModal(undefined, { pinOnly: true }));
    await act(async () => resolve(true));
    expect(result.current.isLocked).toBe(true);
    expect(result.current.isPinModalOpen).toBe(true);
  });

  it('removes biometric enrollment with the PIN and requires PIN and unlock to enroll', async () => {
    const { result } = await setup();
    expect(await result.current.enableBiometric()).toBe(false);
    expect(biometrics.enableBiometric).not.toHaveBeenCalled();
    vi.mocked(biometrics.verifyBiometric).mockResolvedValue(true);
    await act(async () => result.current.openUnlockModal());
    vi.mocked(biometrics.enableBiometric).mockResolvedValue(true);
    await act(async () => expect(await result.current.enableBiometric()).toBe(true));
    expect(biometrics.enableBiometric).toHaveBeenCalledWith('user-1');
    await act(async () => result.current.removePin());
    expect(biometrics.disableBiometric).toHaveBeenCalledWith('user-1');
    expect(result.current.biometricEnabled).toBe(false);
    expect(await result.current.enableBiometric()).toBe(false);
  });

  it('ignores a pending automatic success after manual locking', async () => {
    let resolve!: (success: boolean) => void;
    vi.mocked(biometrics.verifyBiometric).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result } = await setup();
    act(() => result.current.lock());
    await act(async () => resolve(true));
    expect(result.current.isLocked).toBe(true);
    expect(biometrics.verifyBiometric).toHaveBeenCalledTimes(1);
  });

  it('recalculates enrollment for the current user and when disabled', async () => {
    const { result } = await setup();
    expect(result.current.biometricEnabled).toBe(true);
    vi.mocked(biometrics.biometricEnabled).mockImplementation(uid => uid === 'user-1');
    await act(async () => mocks.authCallback?.({ uid: 'user-2' }));
    expect(result.current.biometricEnabled).toBe(false);
    await act(async () => mocks.authCallback?.({ uid: 'user-1' }));
    expect(result.current.biometricEnabled).toBe(true);
    vi.mocked(biometrics.biometricEnabled).mockReturnValue(false);
    act(() => result.current.disableBiometric());
    expect(result.current.biometricEnabled).toBe(false);
    expect(biometrics.disableBiometric).toHaveBeenCalledWith('user-1');
  });

  it('allows enrollment inside the successful PIN callback before the next render', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234flowt-salt-2026'));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ pin_hash: hash }) });
    vi.mocked(biometrics.biometricEnabled).mockReturnValue(false);
    vi.mocked(biometrics.enableBiometric).mockResolvedValue(true);
    const { result } = await setup();
    act(() => result.current.openUnlockModal(success => { if (success) void result.current.enableBiometric(); }));
    await act(async () => expect(await result.current.verifyAndUnlock('1234')).toBe(true));
    expect(biometrics.enableBiometric).toHaveBeenCalledWith('user-1');
  });
});
