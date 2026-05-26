import React from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  type = 'warning',
  isLoading = false,
}) => {
  const typeConfig = {
    danger: {
      iconBg: 'bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 ring-4 ring-rose-500/5',
      confirmBtn: 'bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white shadow-lg shadow-rose-500/20 hover:shadow-rose-500/40 hover:scale-[1.03] active:scale-95 hover:shadow-xl transition-all duration-200 ease-out cursor-pointer',
      accentGlow: 'bg-rose-500/5 dark:bg-rose-500/10',
    },
    warning: {
      iconBg: 'bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-4 ring-amber-500/5',
      confirmBtn: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 hover:scale-[1.03] active:scale-95 hover:shadow-xl transition-all duration-200 ease-out cursor-pointer',
      accentGlow: 'bg-amber-500/5 dark:bg-amber-500/10',
    },
    info: {
      iconBg: 'bg-sky-500/10 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 ring-4 ring-sky-500/5',
      confirmBtn: 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white shadow-lg shadow-sky-500/20 hover:shadow-sky-500/40 hover:scale-[1.03] active:scale-95 hover:shadow-xl transition-all duration-200 ease-out cursor-pointer',
      accentGlow: 'bg-sky-500/5 dark:bg-sky-500/10',
    },
  };

  const config = typeConfig[type] || typeConfig.warning;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" hideHeader={true}>
      <div className="relative flex flex-col items-center text-center p-3 animate-in fade-in zoom-in-95 duration-300">
        {/* Subtle Accent Glow Ring */}
        <div className={`absolute -inset-10 rounded-full blur-3xl opacity-30 pointer-events-none ${config.accentGlow}`} />

        {/* Absolute Top-Right Close Button */}
        <button
          onClick={onClose}
          disabled={isLoading}
          className="absolute -top-1 -right-1 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95"
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>

        {/* Alert/Warning Icon */}
        <div className={`p-4 rounded-full mb-4 shrink-0 transition-all hover:rotate-12 duration-300 ${config.iconBg}`}>
          {type === 'danger' || type === 'warning' ? (
            <AlertTriangle size={32} className="animate-pulse" />
          ) : (
            <HelpCircle size={32} />
          )}
        </div>

        {/* Modal Title */}
        <h4 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight mb-2">
          {title}
        </h4>

        {/* Modal Description */}
        <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm leading-relaxed mb-6 font-semibold max-w-xs">
          {message}
        </p>

        {/* Button Container */}
        <div className="flex items-center gap-3 w-full justify-center z-10">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-350 text-xs font-black uppercase tracking-wider transition-all duration-200 hover:scale-[1.03] active:scale-95 disabled:opacity-50 cursor-pointer border border-transparent shadow-sm hover:shadow"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`
              flex-1 
              px-4 
              py-3 
              rounded-xl 
              text-xs 
              font-black 
              uppercase 
              tracking-wider 
              disabled:opacity-50 
              flex 
              items-center 
              justify-center 
              gap-2
              ${config.confirmBtn}
            `}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Procesando...
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
