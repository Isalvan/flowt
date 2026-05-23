import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface PrivacyContextType {
  isLocked: boolean;
  hasPin: boolean;
  isPinModalOpen: boolean;
  pinModalMode: 'enter' | 'create' | 'confirm';
  lock: () => void;
  openUnlockModal: (callback?: (success: boolean) => void) => void;
  openCreateModal: () => void;
  closePinModal: () => void;
  setPin: (pin: string) => void;
  verifyAndUnlock: (pin: string) => boolean;
  formatCurrency: (value: number) => string;
  formatPlainCurrency: (value: number) => string;
  maskValue: (value: any) => string;
  pinCallback: ((success: boolean) => void) | null;
  setPinModalMode: (mode: 'enter' | 'create' | 'confirm') => void;
  tempNewPin: string;
  setTempNewPin: (pin: string) => void;
}

const PrivacyContext = createContext<PrivacyContextType | undefined>(undefined);

export const PrivacyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasPin, setHasPin] = useState<boolean>(false);
  const [isLocked, setIsLocked] = useState<boolean>(true);
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [pinModalMode, setPinModalMode] = useState<'enter' | 'create' | 'confirm'>('enter');
  const [tempNewPin, setTempNewPin] = useState<string>('');
  const [pinCallback, setPinCallback] = useState<((success: boolean) => void) | null>(null);

  // Load PIN status on mount
  useEffect(() => {
    const storedPin = localStorage.getItem('flowt-security-pin');
    const pinExists = !!storedPin;
    setHasPin(pinExists);
    setIsLocked(true); // Always start locked on app load for maximum privacy and hiding of numbers from the start
  }, []);

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

  const setPin = useCallback((newPin: string) => {
    localStorage.setItem('flowt-security-pin', newPin);
    setHasPin(true);
    setIsLocked(false);
    setIsPinModalOpen(false);
    setTempNewPin('');
  }, []);

  const verifyAndUnlock = useCallback((pin: string): boolean => {
    const storedPin = localStorage.getItem('flowt-security-pin');
    if (storedPin === pin) {
      setIsLocked(false);
      setIsPinModalOpen(false);
      if (pinCallback) {
        pinCallback(true);
      }
      setPinCallback(null);
      return true;
    }
    return false;
  }, [pinCallback]);

  // Clean currency formatting
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
