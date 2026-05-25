import React from 'react';
import { X, Keyboard, PiggyBank, ArrowRightLeft, History, EyeOff, HelpCircle } from 'lucide-react';

interface ShortcutsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsHelpModal: React.FC<ShortcutsHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'N', desc: 'Nueva Hucha de ahorro', icon: <PiggyBank size={16} className="text-indigo-400" /> },
    { key: 'T', desc: 'Traspasar fondos entre huchas', icon: <ArrowRightLeft size={16} className="text-sky-400" /> },
    { key: 'H', desc: 'Historial completo de movimientos', icon: <History size={16} className="text-emerald-400" /> },
    { key: 'P', desc: 'Alternar Privacidad (Ocultar/Bloquear Saldos)', icon: <EyeOff size={16} className="text-rose-400" /> },
    { key: '?', desc: 'Abrir / Cerrar esta ayuda de atajos', icon: <HelpCircle size={16} className="text-violet-400" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md glass-panel p-6 shadow-2xl rounded-3xl border border-white/10 dark:border-white/5 bg-white/90 dark:bg-slate-900/90 animate-in zoom-in-95 duration-200 relative overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        {/* Glow backdrop decorator */}
        <div className="absolute -top-12 -left-12 w-32 h-32 rounded-full bg-indigo-500/10 blur-[40px] pointer-events-none" />

        <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-4 mb-5">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Keyboard size={20} />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-800 dark:text-white uppercase tracking-tight">
                Atajos de Teclado
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Superpoderes financieros</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-650 dark:hover:text-slate-200 flex items-center justify-center transition-all cursor-pointer active:scale-90"
            aria-label="Cerrar modal"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3.5">
          {shortcuts.map((shortcut, index) => (
            <div 
              key={index}
              className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50/50 dark:bg-slate-950/30 border border-slate-150/40 dark:border-white/5 hover:border-indigo-500/20 transition-all duration-200"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/5 shadow-sm">
                  {shortcut.icon}
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {shortcut.desc}
                </span>
              </div>
              <kbd className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-850 text-white dark:text-slate-200 text-xs font-extrabold shadow border border-white/10 shrink-0 font-mono tracking-widest min-w-[32px] text-center">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-white/5 text-center">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
            Presiona cualquier tecla de atajo en tu teclado para probar
          </p>
        </div>
      </div>
    </div>
  );
};
