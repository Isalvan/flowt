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
          0%, 100% { transform: translateY(0px) rotate(-6deg); }
          50% { transform: translateY(-5px) rotate(-8deg); }
        }
        @keyframes float-coins {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-6.5px) rotate(2deg); }
        }
        @keyframes float-star-1 {
          0%, 100% { transform: translate(0px, 0px) scale(0.95) rotate(0deg); }
          50% { transform: translate(-2px, -3px) scale(1.1) rotate(15deg); }
        }
        @keyframes float-star-2 {
          0%, 100% { transform: translate(0px, 0px) scale(1.05) rotate(0deg); }
          50% { transform: translate(2px, -4px) scale(0.95) rotate(-15deg); }
        }
        @keyframes float-star-3 {
          0%, 100% { transform: translate(0px, 0px) scale(0.8); opacity: 0.4; }
          50% { transform: translate(-1px, -2px) scale(1.15); opacity: 0.95; }
        }
        @keyframes drift-blob-1 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          50% { transform: translate(-5px, 4px) scale(1.12); }
        }
        @keyframes drift-blob-2 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          50% { transform: translate(5px, -4px) scale(1.08); }
        }
        @keyframes spin-subtle {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .anim-float-card {
          animation: float-card 6.2s ease-in-out infinite;
          transform-origin: 56px 52px;
        }
        .anim-float-coins {
          animation: float-coins 5s ease-in-out infinite;
          transform-origin: 78px 74px;
        }
        .anim-star-1 {
          animation: float-star-1 4.5s ease-in-out infinite;
          transform-origin: 22px 34px;
        }
        .anim-star-2 {
          animation: float-star-2 5.5s ease-in-out infinite;
          transform-origin: 96px 44px;
        }
        .anim-star-3 {
          animation: float-star-3 3.8s ease-in-out infinite;
          transform-origin: 48px 27px;
        }
        .anim-blob-1 {
          animation: drift-blob-1 8s ease-in-out infinite;
          transform-origin: 35px 40px;
        }
        .anim-blob-2 {
          animation: drift-blob-2 10s ease-in-out infinite;
          transform-origin: 85px 80px;
        }
        .anim-spin-dashed {
          animation: spin-subtle 50s linear infinite;
          transform-origin: 60px 60px;
        }
      `}</style>
      
      <defs>
        {/* Glow Filters */}
        <filter id="meshGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="11" result="blur" />
        </filter>

        {/* Card linear gradient */}
        <linearGradient id="cardGrad" x1="36" y1="38" x2="76" y2="66" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>

        {/* Card Gloss Reflection overlay */}
        <linearGradient id="shineGrad" x1="36" y1="38" x2="76" y2="66" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.45)" />
          <stop offset="25%" stopColor="rgba(255, 255, 255, 0.15)" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
        </linearGradient>

        {/* Gold coin primary gradient */}
        <linearGradient id="goldGrad" x1="68" y1="68" x2="88" y2="88" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="60%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>

        {/* Gold coin light reflection gradient */}
        <linearGradient id="goldGradLight" x1="68" y1="68" x2="88" y2="88" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>

      {/* 1. Ambient Mesh Glow Blobs (Drifting slowly in background) */}
      <circle cx="35" cy="42" r="18" fill="#6366f1" opacity="0.25" filter="url(#meshGlow)" className="anim-blob-1" />
      <circle cx="85" cy="78" r="17" fill="#10b981" opacity="0.2" filter="url(#meshGlow)" className="anim-blob-2" />
      <circle cx="75" cy="35" r="14" fill="#ec4899" opacity="0.16" filter="url(#meshGlow)" className="anim-blob-1" />

      {/* 2. Slow spinning dotted orbit ring */}
      <circle 
        cx="60" 
        cy="60" 
        r="44" 
        stroke="currentColor" 
        strokeWidth="1" 
        strokeDasharray="1 5" 
        className="text-slate-300 dark:text-slate-800 anim-spin-dashed" 
        opacity="0.7"
      />

      {/* 3. Gold Twinkling Stars Floating Freely (Orbiting/Blinking) */}
      <g className="anim-star-1">
        <path 
          d="M22,30 Q22,34 18,34 Q22,34 22,38 Q22,34 26,34 Q22,34 22,30 Z" 
          fill="url(#goldGradLight)" 
          style={{ filter: 'drop-shadow(0px 2px 4px rgba(245,158,11,0.25))' }}
        />
      </g>
      <g className="anim-star-2">
        <path 
          d="M96,40 Q96,44 92,44 Q96,44 96,48 Q96,44 100,44 Q96,44 96,40 Z" 
          fill="#38bdf8" 
          style={{ filter: 'drop-shadow(0px 2px 4px rgba(56,189,248,0.25))' }}
        />
      </g>
      <g className="anim-star-3">
        <path 
          d="M48,23 Q48,26 45,26 Q48,26 48,29 Q48,26 51,26 Q48,26 48,23 Z" 
          fill="#fbbf24" 
          opacity="0.8"
        />
      </g>

      {/* 4. Floating stacked Gold Coins (Adding volume and financial theme) */}
      <g className="anim-float-coins" style={{ filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.08))' }}>
        {/* Flat coin 1 (Base stack) */}
        <ellipse cx="78" cy="79" rx="10" ry="3.5" fill="url(#goldGrad)" stroke="#d97706" strokeWidth="0.6" />
        <ellipse cx="78" cy="77.5" rx="10" ry="3.5" fill="url(#goldGradLight)" stroke="#f59e0b" strokeWidth="0.4" />

        {/* Flat coin 2 (Stacked middle) */}
        <ellipse cx="74" cy="74.5" rx="10" ry="3.5" fill="url(#goldGrad)" stroke="#d97706" strokeWidth="0.6" />
        <ellipse cx="74" cy="73" rx="10" ry="3.5" fill="url(#goldGradLight)" stroke="#f59e0b" strokeWidth="0.4" />

        {/* Standing coin 3 (Upright showing emblem details) */}
        <g style={{ filter: 'drop-shadow(0px 2px 4px rgba(217,119,6,0.3))' }}>
          <circle cx="86" cy="69" r="9" fill="url(#goldGrad)" stroke="#d97706" strokeWidth="0.7" />
          <circle cx="86" cy="69" r="6.8" fill="none" stroke="#fef08a" strokeWidth="0.5" strokeDasharray="1.2 0.8" />
          {/* Standing coin currency emblem */}
          <path 
            d="M85,67.2 C85,66.7 85.5,66.3 86,66.3 C86.5,66.3 87,66.7 87,67.2 C87,67.7 86.5,68 86,68.4 C85.5,68.8 85,69.1 85,69.8 C85,70.3 85.5,70.7 86,70.7 C86.5,70.7 87,70.3 87,69.8" 
            fill="none" 
            stroke="#fef08a" 
            strokeWidth="0.8" 
            strokeLinecap="round" 
          />
          <line x1="86" y1="65.5" x2="86" y2="71.5" stroke="#fef08a" strokeWidth="0.8" strokeLinecap="round" />
        </g>
      </g>

      {/* 5. Floating Glassmorphic Credit Card (floating together in a single animated group) */}
      <g className="anim-float-card" style={{ filter: 'drop-shadow(0px 7px 15px rgba(15,23,42,0.18))' }}>
        {/* Main card body with glassmorphic linear gradient and smooth border */}
        <rect 
          x="36" 
          y="38" 
          width="40" 
          height="28" 
          rx="6" 
          fill="url(#cardGrad)" 
          fillOpacity="0.95"
          stroke="rgba(255,255,255,0.45)" 
          strokeWidth="1.2" 
        />
        
        {/* Gloss glass reflection overlay */}
        <rect 
          x="36" 
          y="38" 
          width="40" 
          height="28" 
          rx="6" 
          fill="url(#shineGrad)" 
          pointerEvents="none"
        />

        {/* Detailed Premium gold chip (with micro lines) */}
        <rect 
          x="42" 
          y="43.5" 
          width="8" 
          height="5.5" 
          rx="1.2" 
          fill="url(#goldGrad)" 
          stroke="#f59e0b" 
          strokeWidth="0.5" 
        />
        <line x1="46" y1="43.5" x2="46" y2="49" stroke="#d97706" strokeWidth="0.4" />
        <line x1="42" y1="46.2" x2="50" y2="46.2" stroke="#d97706" strokeWidth="0.4" />
        
        {/* Magnetic stripe/decorative lines on card */}
        <line 
          x1="42" y1="53" 
          x2="52" 
          y2="53" 
          stroke="rgba(255,255,255,0.65)" 
          strokeWidth="1.2" 
          strokeLinecap="round" 
        />
        <line 
          x1="42" y1="57" 
          x2="60" 
          y2="57" 
          stroke="rgba(255,255,255,0.45)" 
          strokeWidth="1.2" 
          strokeLinecap="round" 
        />
        
        {/* Iridescent laser hologram badge logo in lower corner */}
        <circle cx="67.5" cy="57" r="3" fill="#10b981" fillOpacity="0.8" />
        <circle cx="70.5" cy="57" r="3" fill="#6366f1" fillOpacity="0.6" />
        <circle cx="69" cy="57" r="1.5" fill="#f43f5e" fillOpacity="0.5" />
      </g>
    </svg>
  );
};
