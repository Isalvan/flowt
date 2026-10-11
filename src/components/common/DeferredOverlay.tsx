import { Suspense, useState, type ReactNode } from 'react';

// Keep existing close/reset effects and local state after the first opening.
export const DeferredOverlay = ({ active, children }: { active: boolean; children: ReactNode }) => {
  const [mounted, setMounted] = useState(active);
  if (active && !mounted) setMounted(true);
  return mounted || active ? <Suspense fallback={null}>{children}</Suspense> : null;
};
