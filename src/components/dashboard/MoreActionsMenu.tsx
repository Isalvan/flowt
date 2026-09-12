import React, { useEffect, useRef } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  History,
  Plus,
  HelpCircle,
} from "lucide-react";

interface MoreActionsMenuProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onNewHucha: () => void;
  onTransfer: () => void;
  onHistory: () => void;
}

export const MoreActionsMenu: React.FC<MoreActionsMenuProps> = ({
  open,
  onToggle,
  onClose,
  onNewHucha,
  onTransfer,
  onHistory,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    firstActionRef.current?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        triggerRef.current?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]',
          ) || [],
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (items.length) {
          event.preventDefault();
          items[
            (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
          ].focus();
        }
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  const actions = [
    { label: "Nueva hucha", icon: Plus, onClick: onNewHucha },
    { label: "Traspasar fondos", icon: ArrowRightLeft, onClick: onTransfer },
    { label: "Historial completo", icon: History, onClick: onHistory },
    {
      label: "Ayuda de atajos",
      icon: HelpCircle,
      onClick: () =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" })),
    },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        className="dashboard-secondary-button"
      >
        <span className="text-base leading-none">⋮</span> Más acciones{" "}
        <ChevronDown
          size={15}
          className={
            open ? "rotate-180 transition-transform" : "transition-transform"
          }
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Más acciones"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-52 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {actions.map(({ label, icon: Icon, onClick }, index) => (
            <button
              ref={index === 0 ? firstActionRef : undefined}
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                onClick();
                onClose();
                triggerRef.current?.focus();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-slate-200 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
