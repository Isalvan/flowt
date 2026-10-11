import { lazy, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredOverlay } from './DeferredOverlay';

it('loads only on first opening and preserves the mounted overlay on close', async () => {
  const Panel = ({ open }: { open: boolean }) => {
    const [count, setCount] = useState(0);
    return open ? <button onClick={() => setCount(count + 1)}>Count {count}</button> : null;
  };
  const load = vi.fn(async () => ({ default: Panel }));
  const LazyPanel = lazy(load);
  const overlay = (open: boolean) => <DeferredOverlay active={open}><LazyPanel open={open} /></DeferredOverlay>;
  const { rerender } = render(overlay(false));
  expect(load).not.toHaveBeenCalled();
  rerender(overlay(true));
  fireEvent.click(await screen.findByRole('button', { name: 'Count 0' }));
  rerender(overlay(false));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(overlay(true));
  expect(await screen.findByRole('button', { name: 'Count 1' })).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
});
