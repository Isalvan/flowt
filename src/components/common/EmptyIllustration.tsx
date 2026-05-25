import React from 'react';

export const EmptyIllustration: React.FC = () => {
  return (
    <svg width="100" height="100" viewBox="0 0 120 120" fill="none" className="mb-4 animate-in fade-in zoom-in-90 duration-500 pointer-events-none opacity-80 dark:opacity-60 select-none">
      <defs>
        <linearGradient id="illGrad" x1="0" y1="0" x2="120" y2="120">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <filter id="illGlow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      
      {/* Floating network nodes */}
      <circle 
        cx="60" 
        cy="60" 
        r="44" 
        stroke="url(#illGrad)" 
        strokeWidth="1.2" 
        strokeDasharray="4 6" 
        className="animate-spin" 
        style={{ transformOrigin: '60px 60px', animationDuration: '40s' }} 
      />
      <circle cx="60" cy="60" r="32" stroke="rgba(99, 102, 241, 0.15)" strokeWidth="1" />
      
      {/* Network lines */}
      <line x1="20" y1="60" x2="100" y2="60" stroke="rgba(99, 102, 241, 0.08)" strokeWidth="1" />
      <line x1="60" y1="20" x2="60" y2="100" stroke="rgba(99, 102, 241, 0.08)" strokeWidth="1" />
      
      {/* Dynamic flowing circles */}
      <circle cx="60" cy="16" r="3.5" fill="#0ea5e9" className="animate-bounce" style={{ animationDelay: '0.2s', animationDuration: '2s' }} />
      <circle cx="16" cy="60" r="4" fill="#6366f1" className="animate-pulse" style={{ animationDuration: '3s' }} />
      <circle cx="104" cy="60" r="4" fill="#10b981" className="animate-pulse" style={{ animationDelay: '0.6s', animationDuration: '3.5s' }} />
      <circle cx="60" cy="104" r="3.5" fill="#8b5cf6" className="animate-bounce" style={{ animationDuration: '2.5s' }} />

      {/* Glassmorphic floating credit card in center */}
      <g filter="url(#illGlow)">
        <rect 
          x="44" 
          y="46" 
          width="32" 
          height="28" 
          rx="6" 
          fill="rgba(255, 255, 255, 0.08)" 
          stroke="rgba(255, 255, 255, 0.22)" 
          strokeWidth="1" 
          className="animate-bounce" 
          style={{ animationDuration: '5s' }} 
        />
        {/* Chip element */}
        <rect x="49" y="52" width="7" height="5" rx="1.2" fill="rgba(255, 255, 255, 0.18)" />
        {/* Magnetic stripe / decorative line */}
        <line x1="49" y1="63" x2="62" y2="63" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="1.5" strokeLinecap="round" />
        {/* Glowing circular logo badges */}
        <circle cx="67" cy="68" r="2.2" fill="#10b981" />
        <circle cx="70" cy="68" r="2.2" fill="#6366f1" fillOpacity="0.75" />
      </g>
    </svg>
  );
};
