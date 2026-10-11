import React from 'react';

interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  colorClass?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  className = '',
  colorClass = 'text-brand',
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`flow-meter ${className}`}
    >
      {percentage > 0 && (
        <i
          className={colorClass}
          style={{ width: `${percentage}%` }}
        />
      )}
    </div>
  );
};
