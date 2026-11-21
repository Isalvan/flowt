import { useCallback, useState } from 'react';

export interface Toast { message: string; type: 'error' | 'success' }
export interface ConfirmModal {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

/** Global toasts & confirms shared by every finance action. */
export const useFeedback = () => {
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModal | null>(null);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  return { toast, setToast, confirmModal, setConfirmModal, showToast };
};
