import React, { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  text: string;
  type: ToastType;
  duration?: number;
}

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type,
  onClose,
  duration = 4000,
}) => {
  useEffect(() => {
    // Subtle mobile device haptic feedback triggers on show
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      try {
        if (type === 'success') {
          window.navigator.vibrate(15);
        } else if (type === 'error' || type === 'warning') {
          window.navigator.vibrate([25, 40, 25]);
        } else {
          window.navigator.vibrate(10);
        }
      } catch (err) {
        // Silently catch browser security blocks
      }
    }

    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose, type]);

  const typeConfig = {
    success: {
      bg: 'bg-emerald-500/10 border-emerald-500/20',
      text: 'text-emerald-700 dark:text-emerald-300',
      icon: <CheckCircle2 className="text-emerald-600 dark:text-emerald-400 shrink-0" size={18} />,
      progress: 'bg-emerald-500',
    },
    error: {
      bg: 'bg-rose-500/10 border-rose-500/20',
      text: 'text-rose-700 dark:text-rose-300',
      icon: <AlertCircle className="text-rose-500 dark:text-rose-400 shrink-0" size={18} />,
      progress: 'bg-rose-500',
    },
    warning: {
      bg: 'bg-amber-500/12 border-amber-500/20',
      text: 'text-amber-800 dark:text-amber-300',
      icon: <AlertTriangle className="text-amber-500 shrink-0" size={18} />,
      progress: 'bg-amber-500',
    },
    info: {
      bg: 'bg-brand-tint border-brand/20',
      text: 'text-brand-ink',
      icon: <Info className="text-brand-ink shrink-0" size={18} />,
      progress: 'bg-brand',
    },
  };

  const config = typeConfig[type] || typeConfig.info;

  return (
    <div
      className={`
        flex items-center gap-3 
        p-4 pr-10 
        rounded-2xl 
        border 
        shadow-lg 
        max-w-md 
        w-full
        relative 
        overflow-hidden
        pointer-events-auto
        animate-appear-up
        ${config.bg}
        ${config.text}
      `}
      role="alert"
    >
      {config.icon}
      <span className="text-sm font-medium pr-2">{message}</span>
      <button
        type="button"
        onClick={onClose}
        className="dashboard-icon-button absolute top-2.5 right-2.5 !h-6 !w-6 text-ink-faint hover:text-ink"
        aria-label="Cerrar alerta"
      >
        <X size={14} />
      </button>

      {/* Progress animation line */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-line-strong">
        <div
          className={`h-full ${config.progress}`}
          style={{
            animation: `shrink-progress ${duration}ms linear forwards`,
            transformOrigin: 'left',
          }}
        />
      </div>

      <style>{`
        @keyframes shrink-progress {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
};

// Container for managing multiple toasts stacked
interface ToastContainerProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.text}
          type={toast.type}
          duration={toast.duration}
          onClose={() => onRemove(toast.id)}
        />
      ))}
    </div>
  );
};
