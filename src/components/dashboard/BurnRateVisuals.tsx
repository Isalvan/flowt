import { useEffect, useState } from 'react';

// ExpenseImpactBadge Component
export const ExpenseImpactBadge = ({
  percentage,
  className = '',
}: {
  percentage: number;
  className?: string;
}) => {
  let severity = 'neutral';
  if (percentage > 10) severity = 'critical';
  else if (percentage > 5) severity = 'warning';

  const baseStyles = "relative inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider overflow-hidden backdrop-blur-md border shadow-lg transition-all duration-300";
  
  const severityStyles: Record<string, string> = {
    critical: "bg-red-500/20 border-red-500/50 text-red-100 shadow-[0_0_15px_rgba(239,68,68,0.5),inset_0_0_10px_rgba(239,68,68,0.2)] animate-pulse-shake",
    warning: "bg-amber-500/20 border-amber-500/50 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,0.3),inset_0_0_5px_rgba(245,158,11,0.1)]",
    neutral: "bg-slate-500/20 border-slate-500/30 text-slate-300 shadow-[0_0_5px_rgba(148,163,184,0.1)]"
  };

  const glowStyles: Record<string, string> = {
    critical: "bg-red-400",
    warning: "bg-amber-400",
    neutral: "bg-slate-400"
  };

  return (
    <>
      <style>{`
        @keyframes pulse-shake {
          0%, 100% { transform: scale(1) rotate(0deg); }
          25% { transform: scale(1.02) rotate(1deg); }
          50% { transform: scale(1.04) rotate(-1deg); }
          75% { transform: scale(1.02) rotate(0.5deg); }
        }
        .animate-pulse-shake {
          animation: pulse-shake 2s infinite ease-in-out;
        }
      `}</style>
      <div className={`${baseStyles} ${severityStyles[severity]} ${className}`}>
        {/* Inner glow element */}
        <span className={`absolute -top-2 -left-2 w-8 h-8 rounded-full blur-xl opacity-50 ${glowStyles[severity]}`}></span>
        
        <span className="relative z-10 drop-shadow-md">
          Impact: {percentage.toFixed(1)}%
        </span>
        
        {/* Glossy top highlight for 3D effect */}
        <span className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent rounded-t-full"></span>
      </div>
    </>
  );
};

// HuchaBurnRing Component
export const HuchaBurnRing = ({
  budget,
  spent,
  size = 120,
}: {
  budget: number;
  spent: number;
  size?: number;
}) => {
  const [animatedSpent, setAnimatedSpent] = useState(0);
  const strokeWidth = size * 0.12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  
  // Cap at 100% for the ring display, but calculate actual for colors
  const actualRatio = budget > 0 ? spent / budget : 0;
  const displayRatio = Math.min(Math.max(animatedSpent / budget, 0), 1) || 0;
  
  const strokeDashoffset = circumference - displayRatio * circumference;

  useEffect(() => {
    // Simple spring-like animation effect
    const timeout = setTimeout(() => {
      setAnimatedSpent(spent);
    }, 100);
    return () => clearTimeout(timeout);
  }, [spent]);

  // Determine colors based on burn rate
  let startColor = '#3b82f6'; // blue-500
  let endColor = '#8b5cf6'; // violet-500
  let trackColor = 'rgba(30, 41, 59, 0.5)'; // slate-800
  let shadowColor = 'rgba(59, 130, 246, 0.5)';
  
  if (actualRatio >= 0.9) {
    startColor = '#ef4444'; // red-500
    endColor = '#f97316'; // orange-500
    trackColor = 'rgba(69, 10, 10, 0.5)';
    shadowColor = 'rgba(239, 68, 68, 0.6)';
  } else if (actualRatio >= 0.75) {
    startColor = '#f59e0b'; // amber-500
    endColor = '#eab308'; // yellow-500
    trackColor = 'rgba(69, 26, 3, 0.5)';
    shadowColor = 'rgba(245, 158, 11, 0.5)';
  }

  return (
    <div className="relative inline-flex flex-col items-center justify-center drop-shadow-2xl" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90 filter drop-shadow-lg overflow-visible">
        <defs>
          {/* Gradient for the ring */}
          <linearGradient id={`gradient-${actualRatio}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={startColor} />
            <stop offset="100%" stopColor={endColor} />
          </linearGradient>
          
          {/* Subtle inset shadow filter */}
          <filter id="inset-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feOffset dx="0" dy="2"/>
            <feGaussianBlur stdDeviation="2" result="offset-blur"/>
            <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse"/>
            <feFlood floodColor="black" floodOpacity="0.7" result="color"/>
            <feComposite operator="in" in="color" in2="inverse" result="shadow"/>
            <feComposite operator="over" in="shadow" in2="SourceGraphic"/>
          </filter>
        </defs>

        {/* Track (Background Ring) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          filter="url(#inset-shadow)"
          className="transition-colors duration-500"
        />

        {/* Progress Ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#gradient-${actualRatio})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: 'stroke-dashoffset 1.5s cubic-bezier(0.34, 1.56, 0.64, 1), stroke 0.5s ease',
            filter: `drop-shadow(0px 0px 8px ${shadowColor})`
          }}
        />
        
        {/* Inner glass highlight */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - strokeWidth/2}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={1}
        />
      </svg>
      
      {/* Center Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest drop-shadow-md">Burn</span>
        <span className={`text-xl font-bold tracking-tighter drop-shadow-lg ${actualRatio >= 0.9 ? 'text-red-100' : actualRatio >= 0.75 ? 'text-amber-100' : 'text-slate-100'}`}>
          {Math.round(displayRatio * 100)}%
        </span>
      </div>
    </div>
  );
};
