import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export const BentoMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const desktopMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (desktopMenuRef.current && !desktopMenuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const AppsGrid = () => (
    <>
      <a href="https://aether-hub-1234.web.app" className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-[rgba(247,249,255,0.95)] dark:bg-transparent border border-[rgba(100,120,160,0.12)] dark:border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 transition-all group">
        <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 shadow-[0_5px_14px_rgba(50,65,100,0.10)] dark:shadow-none flex items-center justify-center group-hover:scale-110 transition-transform">
          <img src="/aether.png" alt="Aether" className="w-8 h-8 object-contain rounded-full p-[2px] dark:bg-[#ffffff] dark:shadow-sm" />
        </div>
        <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Aether</span>
      </a>
      <a href="https://flowt-63536.web.app" className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-[rgba(91,124,250,0.10)] dark:bg-indigo-500/10 border border-[rgba(91,124,250,0.28)] dark:border-indigo-500/20 shadow-[0_8px_24px_rgba(91,124,250,0.12)] dark:shadow-none transition-all group">
        <div className="w-12 h-12 rounded-xl bg-white dark:bg-indigo-500/20 shadow-[0_5px_14px_rgba(50,65,100,0.10)] dark:shadow-none flex items-center justify-center group-hover:scale-110 transition-transform">
          <img src="/flowt-logo.png" alt="Flowt" className="w-8 h-8 object-contain" />
        </div>
        <span className="text-[10px] font-bold text-[#5B7CFA] dark:text-indigo-300">Flowt</span>
      </a>
      <a href="https://zenithfit-gym.web.app" className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-[rgba(247,249,255,0.95)] dark:bg-transparent border border-[rgba(100,120,160,0.12)] dark:border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 transition-all group">
        <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 shadow-[0_5px_14px_rgba(50,65,100,0.10)] dark:shadow-none flex items-center justify-center group-hover:scale-110 transition-transform">
          <img src="/zenithfit-logo.png" alt="Zenith" className="w-8 h-8 object-contain" style={{ filter: 'drop-shadow(0 0 5px rgba(0,238,255,0.5))' }} />
        </div>
        <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Zenith</span>
      </a>
    </>
  );

  return (
    <>
      {/* --- DESKTOP VERSION --- */}
      <div className="hidden md:block relative" ref={desktopMenuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200/30 dark:border-white/5 flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95 hover:shadow-md hover:shadow-slate-500/5"
          title="Aplicaciones Aether"
        >
          <img src="/aether.png" alt="Aether Hub" className="w-6 h-6 object-contain rounded-full p-[2px] dark:bg-[#ffffff] dark:shadow-sm" />
        </button>

        {isOpen && (
          <div className="absolute top-12 right-0 w-72 p-4 rounded-3xl backdrop-blur-2xl bg-white/98 dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 shadow-[0_12px_40px_rgba(15,23,42,0.16)] dark:shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-200">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[rgba(55,70,100,0.72)] dark:text-slate-400 mb-4 px-2">Aether Hub</div>
            <div className="grid grid-cols-3 gap-3">
              <AppsGrid />
            </div>
          </div>
        )}
      </div>

      {/* --- MOBILE VERSION (FAB) --- */}
      {typeof document !== 'undefined' && createPortal(
        <div className="md:hidden fixed bottom-28 right-4 z-[200]" ref={mobileMenuRef}>
          {isMobileOpen && (
            <div className="absolute bottom-16 right-0 w-[85vw] max-w-sm p-4 rounded-3xl backdrop-blur-2xl bg-white/98 dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 shadow-[0_12px_40px_rgba(15,23,42,0.16)] dark:shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-4 duration-200 origin-bottom-right mb-2">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-[rgba(55,70,100,0.72)] dark:text-slate-400 mb-4 px-2">Aether Hub</div>
              <div className="grid grid-cols-3 gap-3">
                <AppsGrid />
              </div>
            </div>
          )}
          
          <button
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="w-14 h-14 rounded-full bg-slate-900 dark:bg-white border border-slate-800 dark:border-white/10 flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-[0_8px_30px_rgba(15,23,42,0.3)] dark:shadow-[0_8px_30px_rgba(255,255,255,0.3)]"
            title="Aplicaciones Aether"
          >
            <img src="/aether.png" alt="Aether Hub" className="w-8 h-8 object-contain rounded-full p-[2px] bg-[#ffffff] shadow-sm" />
          </button>
        </div>,
        document.body
      )}
    </>
  );
};
