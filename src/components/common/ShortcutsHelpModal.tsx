import React from 'react';
import { PiggyBank, ArrowRightLeft, History, EyeOff, HelpCircle, Plus } from 'lucide-react';
import { Modal } from './Modal';

interface ShortcutsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsHelpModal: React.FC<ShortcutsHelpModalProps> = ({ isOpen, onClose }) => {
  const shortcuts = [
    { key: 'N', desc: 'Nueva hucha de ahorro', icon: <PiggyBank size={16} /> },
    { key: 'M', desc: 'Registrar movimiento manual (efectivo/banco)', icon: <Plus size={16} /> },
    { key: 'T', desc: 'Traspasar fondos entre huchas', icon: <ArrowRightLeft size={16} /> },
    { key: 'H', desc: 'Historial completo de movimientos', icon: <History size={16} /> },
    { key: 'P', desc: 'Alternar privacidad (ocultar/bloquear saldos)', icon: <EyeOff size={16} /> },
    { key: '?', desc: 'Abrir / cerrar esta ayuda de atajos', icon: <HelpCircle size={16} /> },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" title="Atajos de teclado">
      <p className="dashboard-subtitle -mt-3 mb-4">
        Superpoderes financieros
      </p>

      <div className="space-y-2.5">
        {shortcuts.map((shortcut, index) => (
          <div 
            key={index}
            className="flex items-center justify-between p-3 rounded-2xl bg-surface-2"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-surface text-ink-soft flex items-center justify-center shrink-0">
                {shortcut.icon}
              </div>
              <span className="text-xs font-semibold text-ink truncate">
                {shortcut.desc}
              </span>
            </div>
            <kbd className="px-2.5 py-1 rounded-lg bg-surface text-ink text-xs font-bold font-mono border border-line-strong shadow-xs shrink-0 min-w-[28px] text-center">
              {shortcut.key}
            </kbd>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-3 border-t border-line text-center">
        <p className="text-[11px] font-semibold text-ink-faint">
          Presiona cualquier tecla de atajo en tu teclado para probar
        </p>
      </div>
    </Modal>
  );
};
