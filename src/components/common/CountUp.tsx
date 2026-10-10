import React from 'react';
import { useCountUp } from '../../hooks/useCountUp';

interface CountUpProps {
  end: number;
  decimals?: number;
  decimal?: string;
  separator?: string;
  suffix?: string;
  prefix?: string;
  duration?: number;
  /** Count on from the figure already on screen instead of restarting at zero. */
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
  preserveValue = false,
}) => {
  const value = useCountUp(end, duration, preserveValue);

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
