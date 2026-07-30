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
          setErrorMessage(`PIN Incorrecto. Espera ${delayTime / 1000}s`);
          
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xl animate-in fade-in duration-300">
      
      {/* Glassmorphic Pad Card */}
      <div 
        className={`relative glass-panel max-w-sm w-full mx-4 p-8 border border-white/10 text-center flex flex-col items-center justify-between min-h-[480px] shadow-2xl rounded-3xl transition-transform duration-300 ${
          isShaking ? 'animate-shake border-rose-500/30' : ''
        } ${isSuccess ? 'scale-95 duration-500 border-emerald-500/20' : ''}`}
      >
        {/* Close button if PIN already exists */}
        {/* Close button if PIN already exists */}
        {hasPin && pinModalMode === 'enter' && (
          <button 
            onClick={closePinModal}
            className="absolute top-4 right-4 text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 p-1.5 rounded-xl hover:bg-white/5 transition-all active:scale-90"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Lock Screen Header */}
        <div className="flex flex-col items-center gap-3">
          <div className={`p-4 rounded-full border transition-all duration-500 ${
            isSuccess 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 scale-110 shadow-lg shadow-emerald-500/10' 
              : isShaking 
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 animate-pulse'
          }`}>
            {isSuccess ? <Sparkles className="w-8 h-8" /> : <Lock className="w-8 h-8" />}
          </div>
          
          <h3 className="text-xl font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-tight mt-1">
            {getHeading()}
          </h3>
          <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-400 max-w-[260px] mx-auto font-medium">
            {getSubtitle()}
          </p>
        </div>

        {/* Pin Dots indicator */}
        <div className="my-6">
          <div className="flex justify-center gap-4">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className={`w-4.5 h-4.5 rounded-full border-2 transition-all duration-200 ${
                  index < pin.length
                    ? isSuccess 
                      ? 'bg-emerald-500 border-emerald-500 scale-110' 
                      : isShaking 
                        ? 'bg-rose-500 border-rose-500' 
                        : 'bg-indigo-500 border-indigo-500 scale-110 shadow-md shadow-indigo-500/15'
                    : 'bg-transparent border-slate-350 dark:border-slate-700'
                }`}
              />
            ))}
          </div>
          
          {/* Error Message */}
          <div className="h-4 mt-3">
            {errorMessage && (
              <span className="flex items-center justify-center gap-1 text-[10px] font-extrabold text-rose-500 uppercase tracking-wider animate-bounce">
                <AlertTriangle className="w-3.5 h-3.5" />
                {errorMessage}
              </span>
            )}
          </div>
        </div>

        {/* Touch Numerical Keypad Grid or Recovery */}
        <div className="w-full max-w-[270px] relative min-h-[260px] flex items-center justify-center">
          {isRecoveryMode ? (
            <div className="flex flex-col items-center justify-center w-full h-full animate-in zoom-in-95 duration-300">
               {/* Premium Protection SVG giving soul to the recovery page */}
               <div className="relative w-20 h-20 mb-6 flex items-center justify-center group">
                 {/* Background pulse effect */}
                 <div className="absolute inset-0 rounded-full bg-indigo-500/20 blur-xl group-hover:bg-indigo-500/30 transition-all duration-500" />
                 
                 <svg viewBox="0 0 24 24" className="w-14 h-14 text-indigo-500 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)] relative z-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {/* Security Shield */}
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" className="stroke-indigo-400" />
                    {/* User profile inside shield */}
                    <circle cx="12" cy="11" r="3" className="fill-indigo-500/20 stroke-indigo-300" />
                    <path d="M7 21v-1a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v1" className="stroke-indigo-300" />
                    {/* Scanning orbit line */}
                    <circle cx="12" cy="12" r="14" className="stroke-indigo-500/20 animate-spin-slow" strokeDasharray="4 4" />
                 </svg>
               </div>
               
               <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-6 px-2 leading-relaxed font-semibold">
                 Verifica tu identidad con Google para borrar tu PIN de forma segura.
               </p>
               
               <button 
                 onClick={handleGoogleRecovery}
                 disabled={isRecovering}
                 className="relative w-full py-3.5 rounded-2xl bg-gradient-to-r from-slate-800 to-slate-900 dark:from-white/10 dark:to-white/5 hover:from-slate-700 hover:to-slate-800 text-white font-extrabold text-[11px] uppercase tracking-widest shadow-xl hover:shadow-2xl hover:scale-[1.02] active:scale-95 transition-all duration-300 border border-white/10 flex items-center justify-center gap-3 overflow-hidden group"
               >
                 {/* Google G icon SVG */}
                 <div className="bg-white p-1 rounded-full group-hover:scale-110 transition-transform">
                   <svg className="w-4 h-4" viewBox="0 0 24 24">
                     <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                     <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                     <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                     <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                   </svg>
                 </div>
                 {isRecovering ? 'Verificando...' : 'Verificar Identidad'}
                 <div className="absolute inset-0 bg-white/5 translate-y-full hover:translate-y-0 transition-transform duration-300" />
               </button>

               <button 
                 onClick={() => setIsRecoveryMode(false)}
                 className="mt-5 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
               >
                 Cancelar
               </button>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full animate-in fade-in duration-300">
              <div className="grid grid-cols-3 gap-x-6 gap-y-3 w-full">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleKeyPress(num)}
                    className="w-14 h-14 rounded-full text-lg font-black text-slate-700 dark:text-slate-200 bg-white/40 dark:bg-slate-900/40 border border-white/5 hover:border-indigo-500/30 hover:bg-indigo-500/10 active:scale-90 transition-all cursor-pointer flex items-center justify-center shadow-sm select-none relative overflow-hidden group"
                  >
                    <span className="relative z-10">{num}</span>
                    <div className="absolute inset-0 bg-white/20 scale-0 group-active:scale-100 transition-transform rounded-full origin-center" />
                  </button>
                ))}
                
                {/* Bottom Row: Clear, 0, Backspace */}
                <button
                  type="button"
                  onClick={handleClear}
                  className="w-14 h-14 rounded-full text-[11px] font-black uppercase tracking-wider text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 active:scale-90 transition-all cursor-pointer flex items-center justify-center select-none"
                >
                  Limpiar
                </button>
                
                <button
                  type="button"
                  onClick={() => handleKeyPress('0')}
                  className="w-14 h-14 rounded-full text-lg font-black text-slate-700 dark:text-slate-200 bg-white/40 dark:bg-slate-900/40 border border-white/5 hover:border-indigo-500/30 hover:bg-indigo-500/10 active:scale-90 transition-all cursor-pointer flex items-center justify-center shadow-sm select-none relative overflow-hidden group"
                >
                  <span className="relative z-10">0</span>
                  <div className="absolute inset-0 bg-white/20 scale-0 group-active:scale-100 transition-transform rounded-full origin-center" />
                </button>
                
                <button
                  type="button"
                  onClick={handleBackspace}
                  className="w-14 h-14 rounded-full text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 active:scale-90 transition-all cursor-pointer flex items-center justify-center select-none"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>

              {/* Recovery Button Link */}
              {pinModalMode === 'enter' && (
                 <button 
                   onClick={handleRecoverClick}
                   className="mt-6 text-[9px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors animate-pulse hover:animate-none border-b border-indigo-500/30 pb-0.5"
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
