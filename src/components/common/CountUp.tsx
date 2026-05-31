import React, { useState, useEffect } from 'react';

interface CountUpProps {
  end: number;
  decimals?: number;
  decimal?: string;
  separator?: string;
  suffix?: string;
  prefix?: string;
  duration?: number;
  preserveValue?: boolean;
}

export const CountUp: React.FC<CountUpProps> = ({
  end,
  decimals = 0,
  decimal = ',',
  separator = '.',
  suffix = '',
  prefix = '',
  duration = 1.5,
}) => {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / (duration * 1000), 1);
      
      // easeOutExpo para un efecto realista de frenado
      const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      
      setValue(end * easeOut);
      
      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      } else {
        setValue(end);
      }
    };
    
    animationFrameId = window.requestAnimationFrame(step);
    
    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [end, duration]);

  const formatNumber = (num: number) => {
    const isNegative = num < 0;
    const absNum = Math.abs(num);
    const fixed = absNum.toFixed(decimals);
    const parts = fixed.split('.');
    const intPart = parts[0];
    const decPart = parts.length > 1 ? parts[1] : '';
    
    const intWithSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
    const formattedDecPart = decPart ? `${decimal}${decPart}` : '';
    
    const minus = isNegative ? '-' : '';
    return `${minus}${prefix}${intWithSeparators}${formattedDecPart}${suffix}`;
  };

  return <span>{formatNumber(value)}</span>;
};

export default CountUp;
