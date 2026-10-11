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
  const isDestructive = type === 'danger';

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" hideHeader={true} overflowVisible={true}>
      <div className="relative flex flex-col items-center text-center p-2 animate-in fade-in duration-200">
        {/* Absolute Top-Right Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="dashboard-icon-button absolute -top-1 -right-1"
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>

        {/* Alert/Warning Icon */}
        <div
          className={`dashboard-icon mb-3 ${
            type === 'danger'
              ? 'bg-rose-500/10 text-rose-500 dark:text-rose-400'
              : type === 'warning'
                ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                : 'bg-brand-tint text-brand-ink'
          }`}
        >
          {type === 'danger' || type === 'warning' ? (
            <AlertTriangle size={18} />
          ) : (
            <HelpCircle size={18} />
          )}
        </div>

        {/* Modal Title */}
        <h4 className="dashboard-heading mb-1 text-center">
          {title}
        </h4>

        {/* Modal Description */}
        <p className="dashboard-subtitle text-center mb-5 max-w-xs">
          {message}
        </p>

        {/* Button Container */}
        <div className="modal-actions w-full">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="dashboard-secondary-button"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={isDestructive ? 'dashboard-danger-button' : 'dashboard-primary-button'}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Procesando…
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
