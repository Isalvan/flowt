import React, { useEffect } from 'react';
import { User, LogOut, Key, ShieldOff, X } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';

interface ProfilePanelProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onLogout: () => void;
}

export const ProfilePanel: React.FC<ProfilePanelProps> = ({
  isOpen,
  onClose,
  user,
  onLogout
}) => {
  const { hasPin, openCreateModal, removePin, isLocked } = usePrivacy();

  // Close on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleChangePin = () => {
    onClose();
    if (isLocked) {
      // If locked, we need to unlock first before changing, but openCreateModal overwrites it immediately.
      // Wait, openCreateModal sets mode to 'create'. 
      openCreateModal();
    } else {
      openCreateModal();
    }
  };

  const handleRemovePin = async () => {
    await removePin();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300 cursor-pointer"
        onClick={onClose}
      />
      
      {/* Slide-over Panel */}
      <div className="absolute top-0 right-0 h-full w-full max-w-sm bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl border-l border-white/50 dark:border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-500 ease-spring">
        
        {/* Header Area with Custom Premium SVG */}
        <div className="relative h-48 w-full overflow-hidden shrink-0 rounded-bl-3xl">
          {/* Background Gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600" />
          
          {/* Abstract SVG giving soul */}
          <svg viewBox="0 0 400 200" className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-50" preserveAspectRatio="none">
            <path d="M0,100 C150,200 250,0 400,100 L400,0 L0,0 Z" fill="url(#waveGrad1)" />
            <path d="M0,150 C200,50 300,250 400,150 L400,0 L0,0 Z" fill="url(#waveGrad2)" />
            <defs>
              <linearGradient id="waveGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="waveGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
          
          {/* Close Button */}
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 w-8 h-8 rounded-full bg-black/20 text-white hover:bg-black/40 flex items-center justify-center backdrop-blur-md transition-all active:scale-90"
          >
            <X size={16} strokeWidth={3} />
          </button>

          {/* User Info Overlay */}
          <div className="absolute bottom-6 left-6 right-6 flex items-end gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-lg transform rotate-3">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-full h-full rounded-2xl object-cover" />
              ) : (
                <User size={32} className="text-white drop-shadow-md" />
              )}
            </div>
            <div className="pb-1 text-white drop-shadow-md flex-1">
              <h2 className="text-xl font-black tracking-tight leading-none mb-1">
                {user?.displayName || 'Usuario'}
              </h2>
              <p className="text-[11px] font-semibold opacity-90 truncate max-w-[200px]">
                {user?.email || 'Modo Demo'}
              </p>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
          
          {/* Security Section */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">
              Seguridad de la Cuenta
            </h3>
            
            <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200/50 dark:border-white/5 rounded-2xl p-2 flex flex-col gap-1">
              
              <button 
                onClick={handleChangePin}
                className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-white dark:hover:bg-slate-800 transition-colors group text-left"
              >
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center group-hover:scale-110 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                  <Key size={18} />
                </div>
                <div className="flex-1">
                  <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">
                    {hasPin ? 'Cambiar PIN actual' : 'Crear un nuevo PIN'}
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Protege tus saldos con código de 4 dígitos
                  </span>
                </div>
              </button>

              {hasPin && (
                <button 
                  onClick={handleRemovePin}
                  className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-white dark:hover:bg-slate-800 transition-colors group text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center group-hover:scale-110 group-hover:bg-rose-500 group-hover:text-white transition-all">
                    <ShieldOff size={18} />
                  </div>
                  <div className="flex-1">
                    <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">
                      Eliminar PIN
                    </span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Desactivar la protección por código
                    </span>
                  </div>
                </button>
              )}
            </div>
          </section>

          {/* Account Actions */}
          <section className="mt-auto">
             <button
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="w-full py-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500 text-rose-600 dark:text-rose-400 hover:text-white font-extrabold text-xs uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-3 group"
              >
                <LogOut size={16} className="group-hover:-translate-x-1 transition-transform" />
                Cerrar Sesión
              </button>
          </section>

        </div>
      </div>
    </div>
  );
};
