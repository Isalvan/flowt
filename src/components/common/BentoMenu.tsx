import React from 'react';
import { createPortal } from 'react-dom';

export const BentoMenu: React.FC = () => {
  return (
    <>
      {/* --- DESKTOP VERSION --- */}
      <div className="hidden md:block relative">
        <a
          href="https://aether-hub-1234.web.app"
          className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200/30 dark:border-white/5 flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95 hover:shadow-md hover:shadow-slate-500/5"
          title="Ir a Aether Hub"
        >
          <img src="/aether.png" alt="Aether Hub" className="w-6 h-6 object-contain rounded-full p-[2px] dark:bg-[#ffffff] dark:shadow-sm" />
        </a>
      </div>

      {/* --- MOBILE VERSION (FAB) --- */}
      {typeof document !== 'undefined' && createPortal(
        <div className="md:hidden fixed bottom-28 right-4 z-[200]">
          <a
            href="https://aether-hub-1234.web.app"
            className="w-14 h-14 rounded-full bg-slate-900 dark:bg-white border border-slate-800 dark:border-white/10 flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-[0_8px_30px_rgba(15,23,42,0.3)] dark:shadow-[0_8px_30px_rgba(255,255,255,0.3)] block"
            title="Ir a Aether Hub"
          >
            <img src="/aether.png" alt="Aether Hub" className="w-8 h-8 object-contain rounded-full p-[2px] bg-[#ffffff] shadow-sm" />
          </a>
        </div>,
        document.body
      )}
    </>
  );
};
