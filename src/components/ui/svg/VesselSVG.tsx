import React from 'react';

interface VesselSVGProps {
  progress: number; // 0 to 1
  colorHex: string;
  className?: string;
}

export const VesselSVG: React.FC<VesselSVGProps> = ({ progress, colorHex, className = '' }) => {
  // Constrain progress between 0 and 1
  const safeProgress = Math.min(Math.max(progress, 0), 1);
  
  // Vessel dimensions
  const width = 120;
  const height = 160;
  
  // Vessel internal path bounding: Y goes from roughly 140 (bottom) to 20 (top)
  const topY = 20;
  const bottomY = 140;
  const rangeY = bottomY - topY;
  
  // Calculate the fluid level Y coordinate
  const fillY = bottomY - (rangeY * safeProgress);

  return (
    <svg 
      viewBox={`0 0 ${width} ${height}`} 
      className={`overflow-visible ${className}`}
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`liquidGrad-${colorHex.replace('#', '')}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={colorHex} stopOpacity="0.9" />
          <stop offset="100%" stopColor={colorHex} stopOpacity="0.4" />
        </linearGradient>

        <linearGradient id="glassGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.8" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>

        {/* Mask for the liquid so it stays inside the glass vessel shape */}
        <mask id="vesselMask">
          <path 
            d="M 30,20 L 90,20 L 100,40 L 100,120 L 80,140 L 40,140 L 20,120 L 20,40 Z" 
            fill="white" 
          />
        </mask>
      </defs>

      {/* Back side of the glass */}
      <path 
        d="M 30,20 L 90,20 L 100,40 L 100,120 L 80,140 L 40,140 L 20,120 L 20,40 Z" 
        fill="url(#glassGrad)"
        className="text-slate-400 dark:text-white"
        opacity="0.1"
      />

      {/* LIQUID FILL (Masked by the vessel shape, without SVG filter to avoid browser clipping bugs) */}
      <g mask="url(#vesselMask)">
        {safeProgress > 0 && (
          <rect 
            x="0" 
            y={fillY} 
            width={width} 
            height={height - fillY} 
            fill={`url(#liquidGrad-${colorHex.replace('#', '')})`}
            className="transition-all duration-1000 ease-out"
          />
        )}
        {/* Animated surface line of the liquid */}
        {safeProgress > 0 && safeProgress < 1 && (
          <path 
            d={`M 15,${fillY} Q 60,${fillY - 10} 105,${fillY}`} 
            stroke={colorHex} 
            strokeWidth="3" 
            fill="none"
            opacity="0.9"
            className="transition-all duration-1000 ease-out"
          >
            <animate attributeName="d" 
              values={`M 15,${fillY} Q 60,${fillY - 8} 105,${fillY}; M 15,${fillY} Q 60,${fillY + 8} 105,${fillY}; M 15,${fillY} Q 60,${fillY - 8} 105,${fillY}`} 
              dur="3s" 
              repeatCount="indefinite" 
            />
          </path>
        )}
      </g>

      {/* Front side outline / wireframe of the glass */}
      {/* Increased stroke width and contrast so it's always clearly visible */}
      <path 
        d="M 30,20 L 90,20 L 100,40 L 100,120 L 80,140 L 40,140 L 20,120 L 20,40 Z" 
        stroke="currentColor" 
        strokeWidth="4"
        fill="none"
        className="text-slate-800/40 dark:text-white/50"
      />
      {/* Detail glass lines */}
      <path d="M 30,20 L 20,40" stroke="currentColor" strokeWidth="3" className="text-slate-800/50 dark:text-white/70" />
      <path d="M 90,20 L 100,40" stroke="currentColor" strokeWidth="3" className="text-slate-800/50 dark:text-white/70" />
      <path d="M 20,40 L 100,40" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" className="text-slate-800/30 dark:text-white/40" />
      <path d="M 20,120 L 100,120" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" className="text-slate-800/30 dark:text-white/40" />
      
      {/* Highlight reflection */}
      <path d="M 25,45 L 25,115" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className="text-slate-900/50 dark:text-white/80" />
    </svg>
  );
};
