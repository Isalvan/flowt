import React from 'react';

export const EmptyIllustration: React.FC = () => {
  return (
    <svg 
      width="120" 
      height="120" 
      viewBox="0 0 120 120" 
      fill="none" 
      className="mb-4 pointer-events-none select-none shrink-0"
    >
      <style>{`
        @keyframes float-card {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-4px) rotate(1.5deg); }
        }
        @keyframes float-coin {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(-2.5deg); }
        }
        @keyframes spin-subtle {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.18; transform: scale(1); }
          50% { opacity: 0.38; transform: scale(1.08); }
        }
        @keyframes blink-star {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        .anim-float-card {
          animation: float-card 6s ease-in-out infinite;
          transform-origin: 60px 57px;
        }
        .anim-float-coin {
          animation: float-coin 5s ease-in-out infinite;
          transform-origin: 78px 74px;
        }
        .anim-spin-dashed {
          animation: spin-subtle 40s linear infinite;
          transform-origin: 60px 60px;
        }
        .anim-pulse-glow {
          animation: pulse-glow 8s ease-in-out infinite;
          transform-origin: 60px 60px;
        }
        .anim-blink-1 {
          animation: blink-star 3s ease-in-out infinite;
          transform-origin: 25px 30px;
        }
        .anim-blink-2 {
          animation: blink-star 4s ease-in-out infinite 1.5s;
          transform-origin: 95px 40px;
        }
      `}</style>
      
      <defs>
        {/* Glowing background */}
        <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </radialGradient>
        
        {/* Card linear gradient */}
        <linearGradient id="cardGrad" x1="42" y1="44" x2="78" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>

        {/* Gold coin gradient */}
        <linearGradient id="goldGrad" x1="69" y1="65" x2="87" y2="83" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>

      {/* 1. Pulsing Background Aura */}
      <circle 
        cx="60" 
        cy="60" 
        r="36" 
        fill="url(#bgGlow)" 
        className="anim-pulse-glow" 
      />

      {/* 2. Slow spinning elegant dashed concentric rings */}
      <circle 
        cx="60" 
        cy="60" 
        r="46" 
        stroke="currentColor" 
        strokeWidth="1" 
        strokeDasharray="4 6" 
        className="text-slate-200 dark:text-slate-800 anim-spin-dashed" 
        opacity="0.65"
      />
      <circle 
        cx="60" 
        cy="60" 
        r="32" 
        stroke="currentColor" 
        strokeWidth="0.8" 
        strokeDasharray="1 4" 
        className="text-slate-350 dark:text-slate-700" 
        opacity="0.4"
      />
      
      {/* 3. Subtle outer compass ticks */}
      <line x1="60" y1="8" x2="60" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="text-slate-300 dark:text-slate-750" opacity="0.6" />
      <line x1="60" y1="105" x2="60" y2="112" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="text-slate-300 dark:text-slate-750" opacity="0.6" />
      <line x1="8" y1="60" x2="15" y2="60" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="text-slate-300 dark:text-slate-750" opacity="0.6" />
      <line x1="105" y1="60" x2="112" y2="60" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="text-slate-300 dark:text-slate-750" opacity="0.6" />

      {/* 4. Gold Twinkling Stars */}
      <g className="anim-blink-1">
        <path 
          d="M25,26 Q25,30 21,30 Q25,30 25,34 Q25,30 29,30 Q25,30 25,26 Z" 
          fill="#fbbf24" 
          opacity="0.95"
        />
      </g>
      <g className="anim-blink-2">
        <path 
          d="M95,36 Q95,40 91,40 Q95,40 95,44 Q95,40 99,40 Q95,40 95,36 Z" 
          fill="#fbbf24" 
          opacity="0.9"
        />
      </g>

      {/* 5. Floating Coin (behind the card for layering depth) */}
      <g className="anim-float-coin" style={{ filter: 'drop-shadow(0px 3px 5px rgba(217,119,6,0.25))' }}>
        <circle 
          cx="78" 
          cy="74" 
          r="9" 
          fill="url(#goldGrad)" 
          stroke="#f59e0b" 
          strokeWidth="0.8" 
        />
        <circle 
          cx="78" 
          cy="74" 
          r="6.5" 
          fill="none" 
          stroke="#fef08a" 
          strokeWidth="0.6" 
          strokeDasharray="1.2 0.8" 
        />
        {/* Coin center detail (glowing dollar sign) */}
        <path 
          d="M77,72.2 C77,71.7 77.5,71.3 78,71.3 C78.5,71.3 79,71.7 79,72.2 C79,72.7 78.5,73 78,73.4 C77.5,73.8 77,74.1 77,74.8 C77,75.3 77.5,75.7 78,75.7 C78.5,75.7 79,75.3 79,74.8" 
          fill="none" 
          stroke="#fef08a" 
          strokeWidth="0.8" 
          strokeLinecap="round" 
        />
        <line x1="78" y1="70.5" x2="78" y2="76.5" stroke="#fef08a" strokeWidth="0.8" strokeLinecap="round" />
      </g>

      {/* 6. Floating Glassmorphic Credit Card (floating together in a single animated group) */}
      <g className="anim-float-card" style={{ filter: 'drop-shadow(0px 5px 10px rgba(0,0,0,0.12))' }}>
        {/* Main card body with glassmorphic semi-transparency and smooth border */}
        <rect 
          x="42" 
          y="44" 
          width="36" 
          height="26" 
          rx="5" 
          fill="url(#cardGrad)" 
          fillOpacity="0.9"
          stroke="rgba(255,255,255,0.4)" 
          strokeWidth="1.2" 
        />
        
        {/* Chip element */}
        <rect 
          x="47" 
          y="49.5" 
          width="6.5" 
          height="4.5" 
          rx="1" 
          fill="#fef08a" 
          opacity="0.9"
        />
        
        {/* Magnetic stripe/decorative lines on card */}
        <line 
          x1="47" 
          y1="58" 
          x2="63" 
          y2="58" 
          stroke="rgba(255,255,255,0.55)" 
          strokeWidth="1.2" 
          strokeLinecap="round" 
        />
        <line 
          x1="47" 
          y1="62" 
          x2="56" 
          y2="62" 
          stroke="rgba(255,255,255,0.4)" 
          strokeWidth="1.2" 
          strokeLinecap="round" 
        />
        
        {/* Sleek card logos in corner */}
        <circle cx="69.5" cy="61" r="2" fill="rgba(255,255,255,0.85)" />
        <circle cx="72.5" cy="61" r="2" fill="rgba(255,255,255,0.45)" />
      </g>
    </svg>
  );
};
