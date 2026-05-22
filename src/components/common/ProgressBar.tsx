import React from 'react';

interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  colorClass?: string; // e.g., 'from-sky-400 to-blue-500'
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  className = '',
  colorClass = 'from-sky-400 to-blue-500',
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={`w-full ${className}`}>
      <div className="relative w-full h-3 bg-slate-200/50 dark:bg-slate-800/80 rounded-full overflow-hidden">
        {/* Progress bar fill with glow and gradients */}
        <div
          className={`
            h-full 
            rounded-full 
            bg-gradient-to-r 
            ${colorClass} 
            transition-all 
            duration-500 
            ease-out 
            relative
          `}
          style={{ width: `${percentage}%` }}
        >
          {/* Shimmer / light sweep effect */}
          {percentage > 0 && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
          )}
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2.5s infinite linear;
        }
      `}</style>
    </div>
  );
};
