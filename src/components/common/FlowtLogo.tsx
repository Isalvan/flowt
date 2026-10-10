import { useId } from 'react';

interface FlowtLogoProps {
  size?: number;
  className?: string;
  /** Draws the tail in and pops the ring; for the first screen someone sees. */
  animated?: boolean;
}

/**
 * The Flowt mark as vector: crisp at any size and a few hundred bytes instead
 * of the PNG. Geometry traced from public/flowt-logo.png.
 */
export function FlowtLogo({ size = 28, className = '', animated = false }: FlowtLogoProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="72 30 1180 1180"
      fill="none"
      role="img"
      aria-label="Flowt"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id={`${id}-stem`} x1="230" y1="90" x2="600" y2="1170" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#35aafb" />
          <stop offset="0.45" stopColor="#4c8af7" />
          <stop offset="0.8" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8672c6" />
        </linearGradient>
        <linearGradient id={`${id}-bar`} x1="240" y1="612" x2="950" y2="612" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#70b4fc" />
          <stop offset="1" stopColor="#8595fa" />
        </linearGradient>
        <linearGradient id={`${id}-tail`} x1="470" y1="800" x2="1090" y2="1075" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6b63e9" />
          <stop offset="0.55" stopColor="#c08468" />
          <stop offset="1" stopColor="#ff9f0a" />
        </linearGradient>
        {/* Keeps the ring's eye open where the tail runs underneath it */}
        <mask id={`${id}-eye`} maskUnits="userSpaceOnUse" x="72" y="30" width="1180" height="1180">
          <rect x="72" y="30" width="1180" height="1180" fill="#fff" />
          <circle cx="1094" cy="1072" r="33" fill="#000" />
        </mask>
      </defs>
      <path
        d="M950 146H546A299 299 0 0 0 247 445V1095"
        stroke={`url(#${id}-stem)`}
        strokeWidth="198"
        strokeLinecap="round"
      />
      <path d="M333 612H856" stroke={`url(#${id}-bar)`} strokeWidth="186" strokeLinecap="round" />
      <g mask={`url(#${id}-eye)`}>
        <path
          d="M516 826C660 826 770 880 850 955C915 1016 990 1062 1085 1068"
          stroke={`url(#${id}-tail)`}
          strokeWidth="140"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={animated ? 1 : undefined}
          style={
            animated
              ? { animation: 'flow-draw 900ms var(--ease-soft) 250ms backwards' }
              : undefined
          }
        />
      </g>
      <circle
        cx="1094"
        cy="1072"
        r="57"
        stroke="#ff9f0a"
        strokeWidth="50"
        style={
          animated
            ? {
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: 'flowt-enter 420ms var(--ease-soft) 950ms backwards',
                ['--tw-enter-scale' as string]: 0,
                ['--tw-enter-opacity' as string]: 0,
              }
            : undefined
        }
      />
    </svg>
  );
}
