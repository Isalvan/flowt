import React from 'react';

export const IncomeSVG = ({ className = "" }: { className?: string }) => {
  return (
    <svg 
      className={`w-full h-full opacity-60 mix-blend-screen ${className}`} 
      viewBox="0 0 400 200" 
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="incomeGrad1" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#34d399" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#6ee7b7" stopOpacity="0.8" />
        </linearGradient>
        <filter id="glowIncome" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <path 
        d="M0 200 C 50 180, 100 150, 150 160 S 250 100, 300 80 S 350 40, 400 0 L 400 200 Z" 
        fill="url(#incomeGrad1)" 
        filter="url(#glowIncome)"
      />
      <path 
        d="M0 200 C 80 190, 120 160, 200 130 S 300 120, 350 60 S 380 20, 400 10 L 400 200 Z" 
        fill="url(#incomeGrad1)" 
        opacity="0.6"
      />
    </svg>
  );
};
