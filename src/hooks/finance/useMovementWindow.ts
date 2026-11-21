import { useMemo, useState } from 'react';
import { getMovementWindowStart } from '../../utils/periodStats';
import type { InicioPeriodo } from '../../utils/periods';

/** Start of the movements kept in real time; older ones load on demand. Anchored when the hook mounts. */
export const useMovementWindow = (inicioPeriodo: InicioPeriodo): Date => {
  const [windowAnchor] = useState(() => new Date());
  return useMemo(() => {
    // Payroll dates are not loaded yet: include one extra month to retain the boundary payroll.
    if (inicioPeriodo === 'nomina') return new Date(windowAnchor.getFullYear(), windowAnchor.getMonth() - 13, 1);
    return getMovementWindowStart(windowAnchor, { inicioPeriodo, nominas: [] });
  }, [windowAnchor, inicioPeriodo]);
};
