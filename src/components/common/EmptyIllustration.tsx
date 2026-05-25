import React from 'react';

export const EmptyIllustration: React.FC = () => {
  return (
    <svg 
      width="110" 
      height="110" 
      viewBox="0 0 120 120" 
      fill="none" 
      className="mb-4 animate-in fade-in zoom-in-90 duration-500 pointer-events-none select-none shrink-0"
    >
      <defs>
        <linearGradient id="illGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      
      {/* Outer rotating dashed ring */}
      <circle 
        cx="60" 
        cy="60" 
        r="44" 
        stroke="url(#illGrad)" 
        strokeWidth="1.5" 
        strokeDasharray="4 6" 
        className="animate-spin opacity-50 dark:opacity-40" 
        style={{ transformOrigin: '60px 60px', animationDuration: '40s' }} 
      />
      
      {/* Inner subtle concentric circle */}
      <circle 
        cx="60" 
        cy="60" 
        r="32" 
        stroke="currentColor" 
        strokeWidth="1" 
        className="text-slate-205 dark:text-slate-800/40" 
      />
      
      {/* Centered crosshair coordinate lines */}
      <line x1="20" y1="60" x2="100" y2="60" stroke="currentColor" strokeWidth="1" className="text-slate-150/60 dark:text-slate-900/50" />
      <line x1="60" y1="20" x2="60" y2="100" stroke="currentColor" strokeWidth="1" className="text-slate-150/60 dark:text-slate-900/50" />
      
      {/* Dynamic flowing circles */}
      <circle cx="60" cy="16" r="3.5" fill="#0ea5e9" className="animate-bounce" style={{ animationDuration: '2s' }} />
      <circle cx="16" cy="60" r="4" fill="#6366f1" className="animate-pulse" style={{ animationDuration: '3s' }} />
      <circle cx="104" cy="60" r="4" fill="#10b981" className="animate-pulse" style={{ animationDelay: '0.6s', animationDuration: '3.5s' }} />
      <circle cx="60" cy="104" r="3.5" fill="#8b5cf6" className="animate-bounce" style={{ animationDuration: '2.5s' }} />

      {/* Glassmorphic floating credit card in center */}
      <g style={{ filter: 'drop-shadow(0px 3px 6px rgba(99,102,241,0.15))' }}>
        <rect 
          x="44" 
          y="46" 
          width="32" 
          height="28" 
          rx="6" 
          className="fill-slate-50/95 stroke-slate-300 dark:fill-slate-900/90 dark:stroke-white/20 animate-bounce" 
          strokeWidth="1.2" 
          style={{ animationDuration: '5s' }} 
        />
        {/* Chip element */}
        <rect x="49" y="52" width="7" height="5" rx="1.2" className="fill-amber-400 dark:fill-amber-500/80" />
        {/* Magnetic stripe / decorative line */}
        <line x1="49" y1="63" x2="62" y2="63" className="stroke-slate-350 dark:stroke-slate-700" strokeWidth="1.5" strokeLinecap="round" />
        {/* Glowing circular logo badges */}
        <circle cx="67" cy="68" r="2.2" fill="#10b981" />
        <circle cx="70" cy="68" r="2.2" fill="#6366f1" fillOpacity="0.75" />
      </g>
    </svg>
  );
};
