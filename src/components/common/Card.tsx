import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  glow?: boolean;
  glowColor?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  hoverable = false,
  glow = false,
  glowColor = '',
  ...props
}) => {
  void glow;
  void glowColor;

  return (
    <div
      className={`dashboard-surface p-5 relative overflow-hidden group ${hoverable ? 'is-liftable cursor-pointer' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
