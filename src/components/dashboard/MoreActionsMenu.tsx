import React, { useEffect, useRef } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  Ellipsis,
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
        aria-label="Más acciones"
        className="dashboard-secondary-button"
      >
        <Ellipsis size={16} />
        <span className="hidden sm:inline">Más acciones</span>
        <ChevronDown
          size={15}
          className={`hidden transition-transform duration-200 sm:block ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Más acciones"
          className="glass-panel animate-in fade-in slide-in-from-top-1 absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-2xl p-1.5 duration-150"
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
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-ink transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
            >
              <Icon size={15} className="text-ink-faint" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
