import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  glow?: boolean;
  glowColor?: string; // e.g., 'rgba(56, 189, 248, 0.15)'
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  hoverable = false,
  glow = false,
  glowColor = 'rgba(56, 189, 248, 0.08)',
  ...props
}) => {
  const isGradient = className.includes('bg-gradient-');

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!glow) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.style.setProperty('--x', `${x}px`);
    e.currentTarget.style.setProperty('--y', `${y}px`);
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      className={`
        ${isGradient ? '' : 'glass-panel'}
        rounded-2xl 
        p-6 
        shadow-sm 
        transition-all 
        duration-300 
        ease-out 
        relative 
        overflow-hidden
        group
        ${hoverable ? 'hover:-translate-y-1 hover:shadow-lg hover:border-white/80 dark:hover:border-white/20' : ''}
        ${className}
      `}
      style={{
        boxShadow: glow 
          ? `0 10px 30px -10px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.01), 0 0 20px ${glowColor}`
          : undefined,
        ...props.style,
      }}
      {...props}
    >
      {/* Background radial gradient element for subtle internal glows */}
      {glow && (
        <div 
          className="absolute -inset-px -z-10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{
            background: `radial-gradient(400px circle at var(--x, 0px) var(--y, 0px), ${glowColor}, transparent 80%)`
          }}
        />
      )}
      {children}
    </div>
  );
};
