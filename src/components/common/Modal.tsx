import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  closeOnBackdrop?: boolean;
  hideHeader?: boolean;
  overflowVisible?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnBackdrop = true,
  hideHeader = false,
  overflowVisible = false,
}) => {
  // Listen for escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleEscape);
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Animated blurred backdrop */}
      <div 
        className="fixed inset-0 bg-slate-950/40 dark:bg-black/60 backdrop-blur-md transition-opacity duration-300 animate-fade-in"
        onClick={() => closeOnBackdrop && onClose()}
      />

      {/* Modal Container */}
      <div 
        className={`
          relative 
          w-full 
          ${sizeClasses[size]} 
          glass-panel 
          rounded-2xl 
          shadow-2xl 
          border 
          border-white/20 
          dark:border-slate-800/80 
          p-6 
          z-10 
          transform 
          transition-all 
          duration-300 
          ease-out 
          animate-appear-up
          max-h-[90vh]
          flex
          flex-col
        `}
      >
        {/* Header */}
        {!hideHeader && (
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/60 mb-4 shrink-0">
            {title ? (
              <h3 className="font-title text-xl font-bold text-slate-900 dark:text-white">
                {title}
              </h3>
            ) : (
              <div />
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors duration-150 cursor-pointer"
              aria-label="Cerrar modal"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Content */}
        <div className={`${overflowVisible ? 'overflow-visible' : 'overflow-y-auto custom-scrollbar'} flex-1 pr-1 -mr-2`}>
          {children}
        </div>
      </div>
    </div>
  );
};
