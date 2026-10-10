import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const openModals: string[] = [];
let previousBodyOverflow = '';

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
  const modalId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  // Listen for escape key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!openModals.length) previousBodyOverflow = document.body.style.overflow;
    openModals.push(modalId);
    document.body.style.overflow = 'hidden';
    const handleEscape = (e: KeyboardEvent) => {
      if (openModals.at(-1) !== modalId) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const controls = containerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        if (!controls?.length) { e.preventDefault(); containerRef.current?.focus(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === containerRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    if (!containerRef.current?.contains(document.activeElement)) containerRef.current?.focus();
    window.addEventListener('keydown', handleEscape);

    return () => {
      const index = openModals.indexOf(modalId);
      if (index >= 0) openModals.splice(index, 1);
      if (!openModals.length) document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener('keydown', handleEscape);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, modalId]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Animated blurred backdrop */}
      <div 
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={!hideHeader && title ? `${modalId}-title` : undefined}
        aria-label={hideHeader || !title ? 'Diálogo de Flowt' : undefined}
        tabIndex={-1}
        className="fixed inset-0 bg-slate-950/45 dark:bg-black/65 backdrop-blur-sm animate-fade-in"
        onClick={() => closeOnBackdrop && onClose()}
      />

      {/* Modal Container */}
      <div 
        className={`
          relative 
          w-full 
          ${sizeClasses[size]} 
          glass-panel 
          rounded-3xl 
          p-5 
          sm:p-6 
          z-10 
          animate-appear-up
          max-h-[90vh]
          flex
          flex-col
        `}
      >
        {/* Header */}
        {!hideHeader && (
          <div className="mb-4 flex shrink-0 items-center justify-between gap-3 border-b border-line pb-4">
            {title ? (
              <h3 id={`${modalId}-title`} className="font-title text-xl font-bold text-ink">
                {title}
              </h3>
            ) : (
              <div />
            )}
            <button
              onClick={onClose}
              className="dashboard-icon-button shrink-0"
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
    </div>, document.body
  );
};
