import React, { useState, useEffect, useCallback } from 'react';
import { usePrivacy } from '../../context/PrivacyContext';
import { Lock, Delete, Sparkles, AlertTriangle, X } from 'lucide-react';

export const PinModal: React.FC = () => {
  const {
    isPinModalOpen,
    pinModalMode,
    tempNewPin,
    setTempNewPin,
    verifyAndUnlock,
    setPin,
    closePinModal,
    hasPin,
    setPinModalMode,
    resetPinWithGoogle,
  } = usePrivacy();

  const [pin, setPinState] = useState<string>('');
  const [isShaking, setIsShaking] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [isWaiting, setIsWaiting] = useState<boolean>(false);
  
  const [isRecoveryMode, setIsRecoveryMode] = useState<boolean>(false);
  const [isRecovering, setIsRecovering] = useState<boolean>(false);

  // Focus modal & handle physical keyboard inputs
  useEffect(() => {
    if (!isPinModalOpen) {
      setPinState('');
      setErrorMessage('');
      setIsSuccess(false);
      setIsRecoveryMode(false);
      setIsRecovering(false);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events if user is typing in some other input (though modal is modal)
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape' && hasPin) {
        closePinModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPinModalOpen, pin, pinModalMode, tempNewPin, hasPin]);

  // Handle keypresses (0-9)
  const handleKeyPress = useCallback((digit: string) => {
    if (pin.length >= 4 || isSuccess || isRecoveryMode || isWaiting) return;
    const nextPin = pin + digit;
    setPinState(nextPin);
    setErrorMessage('');
  }, [pin, isSuccess, isRecoveryMode, isWaiting]);

  // Handle backspace
  const handleBackspace = useCallback(() => {
    if (isSuccess || isWaiting) return;
    setPinState(prev => prev.slice(0, -1));
    setErrorMessage('');
  }, [isSuccess, isWaiting]);

  // Handle clear
  const handleClear = useCallback(() => {
    if (isSuccess || isWaiting) return;
    setPinState('');
    setErrorMessage('');
  }, [isSuccess, isWaiting]);

  // Auto trigger check when PIN length reaches 4
  useEffect(() => {
    if (pin.length !== 4) return;

    const processPin = async () => {
      if (pinModalMode === 'enter') {
        const ok = await verifyAndUnlock(pin);
        if (ok) {
          setIsSuccess(true);
          setFailedAttempts(0);
          setTimeout(() => {
            closePinModal();
          }, 600);
        } else {
          // Trigger shake and progressive delay
          const newFailed = failedAttempts + 1;
          setFailedAttempts(newFailed);
          setIsShaking(true);
          setIsWaiting(true);
          
          const delayTime = Math.min(Math.pow(2, newFailed - 1) * 1000, 30000); // 1s, 2s, 4s... max 30s
          setErrorMessage(`PIN incorrecto. Espera ${delayTime / 1000}s`);
          
          setTimeout(() => {
            setIsShaking(false);
          }, 500);
          
          setTimeout(() => {
            setPinState('');
            setErrorMessage('');
            setIsWaiting(false);
          }, delayTime);
        }
      } else if (pinModalMode === 'create') {
        setTempNewPin(pin);
        setPinModalMode('confirm');
        setPinState('');
      } else if (pinModalMode === 'confirm') {
        if (pin === tempNewPin) {
          setIsSuccess(true);
          setTimeout(async () => {
            await setPin(pin);
          }, 600);
        } else {
          setIsShaking(true);
          setErrorMessage('Los PINs no coinciden');
          setTimeout(() => {
            setIsShaking(false);
            setPinState('');
            setTempNewPin('');
            setPinModalMode('create');
          }, 800);
        }
      }
    };

    // Delay slightly to let the last dot animate to filled
    const timer = setTimeout(processPin, 150);
    return () => clearTimeout(timer);
  }, [pin, pinModalMode, tempNewPin, verifyAndUnlock, setPin, setTempNewPin, setPinModalMode, closePinModal, failedAttempts]);

  const handleRecoverClick = () => {
    setIsRecoveryMode(true);
    setPinState('');
    setErrorMessage('');
  };

  const handleGoogleRecovery = async () => {
    setIsRecovering(true);
    const success = await resetPinWithGoogle();
    setIsRecovering(false);
    if (success) {
      setIsRecoveryMode(false);
      // It switches automatically to 'create' mode
    } else {
      setIsShaking(true);
      setErrorMessage('No se pudo verificar la identidad.');
      setTimeout(() => setIsShaking(false), 500);
      setIsRecoveryMode(false);
    }
  };

  if (!isPinModalOpen) return null;

  const getHeading = () => {
    if (pinModalMode === 'create') return 'Configura tu PIN';
    if (pinModalMode === 'confirm') return 'Confirma tu PIN';
    return 'Seguridad PIN';
  };

  const getSubtitle = () => {
    if (pinModalMode === 'create') return 'Define un código de 4 dígitos para ocultar y proteger tu información financiera.';
    if (pinModalMode === 'confirm') return 'Vuelve a introducir el mismo código para confirmarlo.';
    return 'La aplicación se encuentra protegida. Introduce tu PIN de 4 dígitos.';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-in fade-in duration-300">
      
      {/* Glassmorphic Pad Card */}
      <div 
        className={`relative glass-panel max-w-sm w-full mx-4 p-8 text-center flex flex-col items-center justify-between min-h-[480px] rounded-3xl ${
          isShaking ? 'animate-shake' : ''
        }`}
      >
        {/* Close button if PIN already exists */}
        {hasPin && pinModalMode === 'enter' && (
          <button 
            type="button"
            onClick={closePinModal}
            className="dashboard-icon-button absolute top-4 right-4"
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        )}

        {/* Lock Screen Header */}
        <div className="flex flex-col items-center gap-3">
          <div className={`dashboard-icon ${
            isSuccess 
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
              : isShaking 
                ? 'bg-rose-500/10 text-rose-500 dark:text-rose-400' 
                : 'bg-brand-tint text-brand-ink'
          }`}>
            {isSuccess ? <Sparkles size={18} /> : <Lock size={18} />}
          </div>
          
          <h3 className="dashboard-heading mt-1 text-xl">
            {getHeading()}
          </h3>
          <p className="dashboard-subtitle max-w-[260px] mx-auto text-xs">
            {getSubtitle()}
          </p>
        </div>

        {/* Pin Dots indicator */}
        <div className="my-6">
          <div className="flex justify-center gap-4">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className={`h-3.5 w-3.5 rounded-full border-2 transition-colors duration-200 ${
                  index < pin.length
                    ? isSuccess 
                      ? 'bg-emerald-500 border-emerald-500' 
                      : isShaking 
                        ? 'bg-rose-500 border-rose-500' 
                        : 'bg-brand border-brand'
                    : 'bg-transparent border-line-strong'
                }`}
              />
            ))}
          </div>
          
          {/* Error Message */}
          <div className="h-4 mt-3">
            {errorMessage && (
              <span className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-rose-500 dark:text-rose-400">
                <AlertTriangle size={14} className="shrink-0" />
                {errorMessage}
              </span>
            )}
          </div>
        </div>

        {/* Touch Numerical Keypad Grid or Recovery */}
        <div className="w-full max-w-[270px] relative min-h-[260px] flex items-center justify-center">
          {isRecoveryMode ? (
            <div className="flex flex-col items-center justify-center w-full h-full animate-in fade-in duration-300">
               <div className="dashboard-icon mb-4 h-12 w-12 rounded-2xl bg-brand-tint text-brand-ink">
                 <Lock size={20} />
               </div>
               
               <p className="mb-6 px-2 text-xs font-semibold leading-relaxed text-ink-soft">
                 Verifica tu identidad con Google para borrar tu PIN de forma segura.
               </p>
               
               <button 
                 type="button"
                 onClick={handleGoogleRecovery}
                 disabled={isRecovering}
                 className="dashboard-primary-button w-full !py-3.5"
               >
                 {/* Google G icon SVG */}
                 <div className="bg-white p-1 rounded-full">
                   <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                     <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                     <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                     <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                     <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                   </svg>
                 </div>
                 {isRecovering ? 'Verificando…' : 'Verificar identidad'}
               </button>

               <button 
                 type="button"
                 onClick={() => setIsRecoveryMode(false)}
                 className="dashboard-secondary-button mt-3 w-full"
               >
                 Cancelar
               </button>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full animate-in fade-in duration-300">
              <div className="grid grid-cols-3 gap-x-6 gap-y-3 w-full place-items-center">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleKeyPress(num)}
                    className="h-14 w-14 rounded-full text-lg font-bold text-ink bg-surface-2 hover:bg-brand-tint hover:text-brand-ink transition-colors flex items-center justify-center cursor-pointer select-none"
                  >
                    {num}
                  </button>
                ))}
                
                {/* Bottom Row: Clear, 0, Backspace */}
                <button
                  type="button"
                  onClick={handleClear}
                  className="h-14 w-14 rounded-full text-xs font-semibold text-ink-soft hover:text-ink hover:bg-surface-2 transition-colors flex items-center justify-center cursor-pointer select-none"
                >
                  Limpiar
                </button>
                
                <button
                  type="button"
                  onClick={() => handleKeyPress('0')}
                  className="h-14 w-14 rounded-full text-lg font-bold text-ink bg-surface-2 hover:bg-brand-tint hover:text-brand-ink transition-colors flex items-center justify-center cursor-pointer select-none"
                >
                  0
                </button>
                
                <button
                  type="button"
                  onClick={handleBackspace}
                  aria-label="Borrar dígito"
                  className="h-14 w-14 rounded-full text-ink-soft hover:text-ink hover:bg-surface-2 transition-colors flex items-center justify-center cursor-pointer select-none"
                >
                  <Delete size={18} />
                </button>
              </div>

              {/* Recovery Button Link */}
              {pinModalMode === 'enter' && (
                 <button 
                   type="button"
                   onClick={handleRecoverClick}
                   className="mt-5 text-xs font-semibold text-brand-ink hover:underline transition-colors"
                 >
                   ¿Olvidaste el PIN?
                 </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
