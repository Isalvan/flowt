
export const ExpenseSVG = ({ className = "" }: { className?: string }) => {
  return (
    <svg 
      className={`w-full h-full opacity-60 mix-blend-screen ${className}`} 
      viewBox="0 0 400 200" 
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="expenseGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#f43f5e" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#9f1239" stopOpacity="0.1" />
        </linearGradient>
        <filter id="glowExpense" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <path 
        d="M0 0 C 100 20, 150 80, 200 100 S 300 150, 350 180 S 380 190, 400 200 L 0 200 Z" 
        fill="url(#expenseGrad1)" 
        filter="url(#glowExpense)"
      />
      <path 
        d="M0 0 C 50 50, 120 120, 180 140 S 280 170, 320 190 S 360 200, 400 200 L 0 200 Z" 
        fill="url(#expenseGrad1)" 
        opacity="0.6"
      />
    </svg>
  );
};
