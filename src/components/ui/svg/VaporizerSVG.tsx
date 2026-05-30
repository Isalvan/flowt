
export const VaporizerSVG = ({ percentage, className = "" }: { percentage: number, className?: string }) => {
  const safePercentage = Math.max(0, Math.min(100, percentage));
  
  let colorClass = "text-emerald-400";
  let strokeColor = "#34d399";
  let glowColor = "rgba(52, 211, 153, 0.6)";
  
  if (safePercentage > 85) {
    colorClass = "text-rose-500";
    strokeColor = "#f43f5e";
    glowColor = "rgba(244, 63, 94, 0.6)";
  } else if (safePercentage > 65) {
    colorClass = "text-amber-400";
    strokeColor = "#fbbf24";
    glowColor = "rgba(251, 191, 36, 0.6)";
  }

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (safePercentage / 100) * circumference;

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        <defs>
          <filter id={`glow-${safePercentage}`}>
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        {/* Background track */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-gray-800"
        />
        
        {/* Foreground track */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          filter={`url(#glow-${safePercentage})`}
          className="transition-all duration-1000 ease-out"
        />
        
        {/* Abstract inner details */}
        <circle cx="50" cy="50" r={radius - 8} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-gray-700 opacity-50" strokeDasharray="2 4" />
        <circle cx="50" cy="50" r={radius + 8} fill="none" stroke={strokeColor} strokeWidth="1" className="opacity-20" />
      </svg>
      
      {/* Percentage Text */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center ${colorClass}`}>
        <span className="text-2xl font-black tracking-tighter" style={{ textShadow: `0 0 10px ${glowColor}` }}>
          {safePercentage}%
        </span>
      </div>
    </div>
  );
};
