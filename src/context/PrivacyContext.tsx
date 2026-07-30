import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface PrivacyContextType {
  isLocked: boolean;
  hasPin: boolean;
  isPinModalOpen: boolean;
  pinModalMode: 'enter' | 'create' | 'confirm';
  lock: () => void;
  openUnlockModal: (callback?: (success: boolean) => void) => void;
  openCreateModal: () => void;
  closePinModal: () => void;
  setPin: (pin: string) => Promise<void>;
  verifyAndUnlock: (pin: string) => Promise<boolean>;
  resetPinWithGoogle: () => Promise<boolean>;
  removePin: () => Promise<void>;
  formatCurrency: (value: number) => string;
  formatPlainCurrency: (value: number) => string;
  maskValue: (value: any) => string;
  pinCallback: ((success: boolean) => void) | null;
  setPinModalMode: (mode: 'enter' | 'create' | 'confirm') => void;
  tempNewPin: string;
  setTempNewPin: (pin: string) => void;
}

function generateSalt(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// PBKDF2 Hashing
async function hashPinPBKDF2(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fallback for old SHA-256 hashes
async function hashPinLegacy(pin: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(pin + 'flowt-salt-2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PrivacyContext = createContext<PrivacyContextType | undefined>(undefined);

export const PrivacyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasPin, setHasPin] = useState<boolean>(false);
  const [isLocked, setIsLocked] = useState<boolean>(true);
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [pinModalMode, setPinModalMode] = useState<'enter' | 'create' | 'confirm'>('enter');
  const [tempNewPin, setTempNewPin] = useState<string>('');
  const [pinCallback, setPinCallback] = useState<((success: boolean) => void) | null>(null);

  const [memoryPin, setMemoryPin] = useState<string | null>(null);
  const [memorySalt, setMemorySalt] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Load PIN status on mount and subscribe to auth
  useEffect(() => {
    setIsLocked(true); // Always start locked on app load
    localStorage.removeItem('flowt-security-pin'); // Aggressively clean up plaintext
    
    // Clean sessionStorage when no user, handled in auth observer

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        try {
          const docRef = doc(db, 'settings', user.uid);
          const snap = await getDoc(docRef);
          if (snap.exists() && snap.data().pin_hash) {
            setHasPin(true);
            setMemoryPin(snap.data().pin_hash);
            setMemorySalt(snap.data().pin_salt || null);
          } else {
            loadFromSession();
          }
        } catch (e) {
          console.error("Error fetching PIN settings", e);
          loadFromSession();
        }
      } else {
        setUserId(null);
        setHasPin(false);
        setMemoryPin(null);
        setMemorySalt(null);
        sessionStorage.removeItem('flowt-security-pin');
        sessionStorage.removeItem('flowt-pin-salt');
        setIsLocked(true); // Ensure it's locked when logging out
      }
    });

    return () => unsub();
  }, []);

  const loadFromSession = () => {
    const activePin = sessionStorage.getItem('flowt-security-pin');
    const activeSalt = sessionStorage.getItem('flowt-pin-salt');
    if (activePin) {
      setHasPin(true);
      setMemoryPin(activePin);
      setMemorySalt(activeSalt || null);
    } else {
      setHasPin(false);
    }
  };

  const lock = useCallback(() => {
    setIsLocked(true);
  }, []);

  const openUnlockModal = useCallback((callback?: (success: boolean) => void) => {
    setPinModalMode('enter');
    setIsPinModalOpen(true);
    if (callback) {
      setPinCallback(() => callback);
    } else {
      setPinCallback(null);
    }
  }, []);

  const openCreateModal = useCallback(() => {
    setPinModalMode('create');
    setTempNewPin('');
    setIsPinModalOpen(true);
    setPinCallback(null);
  }, []);

  const closePinModal = useCallback(() => {
    setIsPinModalOpen(false);
    setTempNewPin('');
    setPinCallback(null);
  }, []);

  const setPin = useCallback(async (newPin: string) => {
    const salt = generateSalt();
    const hashedPin = await hashPinPBKDF2(newPin, salt);
    
    setMemoryPin(hashedPin);
    setMemorySalt(salt);
    sessionStorage.setItem('flowt-security-pin', hashedPin);
    sessionStorage.setItem('flowt-pin-salt', salt);
    localStorage.removeItem('flowt-security-pin'); 
    
    if (userId) {
      try {
        await setDoc(doc(db, 'settings', userId), { pin_hash: hashedPin, pin_salt: salt }, { merge: true });
      } catch (e) {
        console.error("Error saving PIN to DB", e);
      }
    }

    setHasPin(true);
    setIsLocked(false);
    setIsPinModalOpen(false);
    setTempNewPin('');
  }, [userId]);

  const removePin = useCallback(async () => {
    setMemoryPin(null);
    setMemorySalt(null);
    sessionStorage.removeItem('flowt-security-pin');
    sessionStorage.removeItem('flowt-pin-salt');
    localStorage.removeItem('flowt-security-pin');
    
    if (userId) {
      try {
        await setDoc(doc(db, 'settings', userId), { pin_hash: null, pin_salt: null }, { merge: true });
      } catch (e) {
        console.error("Error removing PIN from DB", e);
      }
    }
    setHasPin(false);
    setIsLocked(false);
  }, [userId]);

  const resetPinWithGoogle = useCallback(async (): Promise<boolean> => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // Re-authenticate user to prove identity
      const result = await signInWithPopup(auth, provider);
      
      // Strict check: ensures they signed in with the same active account
      if (userId && result.user.uid !== userId) {
        return false;
      }

      await removePin();
      setPinModalMode('create');
      return true;
    } catch (error) {
      console.error("Error resetting PIN:", error);
      return false;
    }
  }, [userId, removePin]);

  const verifyAndUnlock = useCallback(async (pin: string): Promise<boolean> => {
    const activePin = memoryPin || sessionStorage.getItem('flowt-security-pin');
    const activeSalt = memorySalt || sessionStorage.getItem('flowt-pin-salt');
    
    if (!activePin) return false;

    let hashedInput = '';
    if (activeSalt) {
      hashedInput = await hashPinPBKDF2(pin, activeSalt);
    } else {
      hashedInput = await hashPinLegacy(pin);
    }

    if (activePin === hashedInput) {
      setMemoryPin(hashedInput);
      if (activeSalt) setMemorySalt(activeSalt);
      sessionStorage.setItem('flowt-security-pin', hashedInput);
      if (activeSalt) sessionStorage.setItem('flowt-pin-salt', activeSalt);
      localStorage.removeItem('flowt-security-pin'); 
      
      setIsLocked(false);
      setIsPinModalOpen(false);
      if (pinCallback) {
        pinCallback(true);
      }
      setPinCallback(null);
      return true;
    }
    return false;
  }, [pinCallback, memoryPin, memorySalt]);

  const formatPlainCurrency = useCallback((value: number): string => {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
  }, []);

  const formatCurrency = useCallback((value: number): string => {
    if (isLocked) {
      return '•••• €';
    }
    return formatPlainCurrency(value);
  }, [isLocked, formatPlainCurrency]);

  const maskValue = useCallback((value: any): string => {
    if (isLocked) {
      return '••••';
    }
    return String(value);
  }, [isLocked]);

  return (
    <PrivacyContext.Provider
      value={{
        isLocked,
        hasPin,
        isPinModalOpen,
        pinModalMode,
        lock,
        openUnlockModal,
        openCreateModal,
        closePinModal,
        setPin,
        verifyAndUnlock,
        resetPinWithGoogle,
        removePin,
        formatCurrency,
        formatPlainCurrency,
        maskValue,
        pinCallback,
        setPinModalMode,
        tempNewPin,
        setTempNewPin,
      }}
    >
      {children}
    </PrivacyContext.Provider>
  );
};

export const usePrivacy = () => {
  const context = useContext(PrivacyContext);
  if (context === undefined) {
    throw new Error('usePrivacy must be used within a PrivacyProvider');
  }
  return context;
};
