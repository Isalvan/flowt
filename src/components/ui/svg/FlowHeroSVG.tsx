import React from 'react';
import { usePrivacy } from '../../../context/PrivacyContext';
import { CountUp } from '../../common/CountUp';

interface FlowHeroSVGProps {
  balance: number;
}

export const FlowHeroSVG: React.FC<FlowHeroSVGProps> = ({ balance }) => {
  const { isLocked } = usePrivacy();
  return (
    <div className="relative w-full h-64 sm:h-80 rounded-[3rem] overflow-hidden bg-slate-950 border border-white/5 shadow-2xl flex items-center justify-center isolate group">
      
      {/* Background ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none mix-blend-screen transition-all duration-1000 group-hover:bg-indigo-500/20" />
      
      {/* SVG Canvas */}
      <svg
        viewBox="0 0 1000 300"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-80"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="flowGlow" x1="0" y1="0" x2="1000" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
            <stop offset="25%" stopColor="#818cf8" stopOpacity="0.8" />
            <stop offset="75%" stopColor="#c084fc" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#e879f9" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="particleGlow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#fff" stopOpacity="1" />
          </linearGradient>

          <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Animation for particles along path */}
          <path id="flowPath1" d="M -100,200 C 200,250 300,50 500,150 C 700,250 800,100 1100,150" />
          <path id="flowPath2" d="M -100,150 C 150,50 350,250 550,150 C 750,50 850,200 1100,100" />
          <path id="flowPath3" d="M -100,250 C 250,150 400,280 600,150 C 800,20 900,150 1100,200" />
        </defs>

        {/* Base fluid lines */}
        <path
          d="M -100,200 C 200,250 300,50 500,150 C 700,250 800,100 1100,150"
          stroke="url(#flowGlow)"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.3"
          filter="url(#neonGlow)"
        />
        <path
          d="M -100,150 C 150,50 350,250 550,150 C 750,50 850,200 1100,100"
          stroke="url(#flowGlow)"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.5"
          filter="url(#neonGlow)"
        />
        <path
          d="M -100,250 C 250,150 400,280 600,150 C 800,20 900,150 1100,200"
          stroke="url(#flowGlow)"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.4"
          filter="url(#neonGlow)"
        />

        {/* Animated Particles flowing through paths */}
        <g filter="url(#neonGlow)">
          <circle r="4" fill="url(#particleGlow)">
            <animateMotion dur="6s" repeatCount="indefinite" path="M -100,200 C 200,250 300,50 500,150 C 700,250 800,100 1100,150" />
          </circle>
          <circle r="6" fill="#fff" opacity="0.8">
            <animateMotion dur="8s" begin="2s" repeatCount="indefinite" path="M -100,150 C 150,50 350,250 550,150 C 750,50 850,200 1100,100" />
          </circle>
          <circle r="3" fill="#a5b4fc">
            <animateMotion dur="5s" begin="1s" repeatCount="indefinite" path="M -100,250 C 250,150 400,280 600,150 C 800,20 900,150 1100,200" />
          </circle>
          <circle r="5" fill="#fbcfe8" opacity="0.9">
            <animateMotion dur="7s" begin="3.5s" repeatCount="indefinite" path="M -100,150 C 150,50 350,250 550,150 C 750,50 850,200 1100,100" />
          </circle>
        </g>
      </svg>

      {/* Content overlay */}
      <div className="z-10 text-center flex flex-col items-center">
        <span className="inline-block px-3 py-1 mb-4 rounded-full bg-indigo-500/10 border border-indigo-400/20 text-indigo-300 text-[10px] font-black uppercase tracking-[0.3em] backdrop-blur-md">
          Energía Acumulada
        </span>
        <div className="relative">
          <span className="absolute -inset-4 bg-white/5 blur-xl rounded-full"></span>
          <h1 className="relative text-5xl sm:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-white/40 tracking-tighter drop-shadow-2xl">
            {isLocked ? '•••• €' : <CountUp end={balance} decimals={2} decimal="," separator="." suffix=" €" preserveValue duration={2} />}
          </h1>
        </div>
      </div>
    </div>
  );
};
