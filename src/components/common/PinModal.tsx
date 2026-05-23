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
  } = usePrivacy();

  const [pin, setPinState] = useState<string>('');
  const [isShaking, setIsShaking] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  // Focus modal & handle physical keyboard inputs
  useEffect(() => {
    if (!isPinModalOpen) {
      setPinState('');
      setErrorMessage('');
      setIsSuccess(false);
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
    if (pin.length >= 4 || isSuccess) return;
    const nextPin = pin + digit;
    setPinState(nextPin);
    setErrorMessage('');
  }, [pin, isSuccess]);

  // Handle backspace
  const handleBackspace = useCallback(() => {
    if (isSuccess) return;
    setPinState(prev => prev.slice(0, -1));
    setErrorMessage('');
  }, [isSuccess]);

  // Handle clear
  const handleClear = useCallback(() => {
    if (isSuccess) return;
    setPinState('');
    setErrorMessage('');
  }, [isSuccess]);

  // Auto trigger check when PIN length reaches 4
  useEffect(() => {
    if (pin.length !== 4) return;

    const processPin = async () => {
      if (pinModalMode === 'enter') {
        const ok = verifyAndUnlock(pin);
        if (ok) {
          setIsSuccess(true);
          setTimeout(() => {
            closePinModal();
          }, 600);
        } else {
          // Trigger shake and clear
          setIsShaking(true);
          setErrorMessage('PIN Incorrecto');
          setTimeout(() => {
            setIsShaking(false);
            setPinState('');
          }, 500);
        }
      } else if (pinModalMode === 'create') {
        setTempNewPin(pin);
        setPinModalMode('confirm');
        setPinState('');
      } else if (pinModalMode === 'confirm') {
        if (pin === tempNewPin) {
          setIsSuccess(true);
          setTimeout(() => {
            setPin(pin);
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
  }, [pin, pinModalMode, tempNewPin, verifyAndUnlock, setPin, setTempNewPin, setPinModalMode, closePinModal]);

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
        {hasPin && pinModalMode === 'enter' && (
          <button 
            onClick={closePinModal}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1.5 rounded-xl hover:bg-white/5 transition-all active:scale-90"
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
          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500 max-w-[260px] mx-auto">
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

        {/* Touch Numerical Keypad Grid */}
        <div className="grid grid-cols-3 gap-x-6 gap-y-3 w-full max-w-[270px]">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleKeyPress(num)}
              className="w-14 h-14 rounded-full text-lg font-black text-slate-700 dark:text-slate-200 bg-white/40 dark:bg-slate-900/40 border border-white/5 hover:border-indigo-500/30 hover:bg-indigo-500/10 active:scale-90 transition-all cursor-pointer flex items-center justify-center shadow-sm select-none"
            >
              {num}
            </button>
          ))}
          
          {/* Bottom Row: Clear, 0, Backspace */}
          <button
            type="button"
            onClick={handleClear}
            className="w-14 h-14 rounded-full text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-200 active:scale-90 transition-all cursor-pointer flex items-center justify-center select-none"
          >
            Limpiar
          </button>
          
          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            className="w-14 h-14 rounded-full text-lg font-black text-slate-700 dark:text-slate-200 bg-white/40 dark:bg-slate-900/40 border border-white/5 hover:border-indigo-500/30 hover:bg-indigo-500/10 active:scale-90 transition-all cursor-pointer flex items-center justify-center shadow-sm select-none"
          >
            0
          </button>
          
          <button
            type="button"
            onClick={handleBackspace}
            className="w-14 h-14 rounded-full text-slate-400 hover:text-slate-200 active:scale-90 transition-all cursor-pointer flex items-center justify-center select-none"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

      </div>
    </div>
  );
};
