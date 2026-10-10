import React from 'react';

/** Way back to Aether Hub. Lives in the header on every screen size. */
export const BentoMenu: React.FC = () => {
  return (
    <a
      href="https://aether-hub-1234.web.app"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors duration-150 hover:bg-surface-2"
      title="Ir a Aether Hub"
      aria-label="Ir a Aether Hub"
    >
      <img
        src="/aether.png"
        alt=""
        className="h-6 w-6 rounded-full object-contain p-[2px] dark:bg-white"
      />
    </a>
  );
};
