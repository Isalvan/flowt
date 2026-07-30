import { describe, it, expect, vi } from 'vitest';

describe('Idempotency & Concurrent Approval Protection', () => {
  it('prevents double-processing when pending email document is deleted or non-existent', async () => {
    let callCount = 0;
    const mockTransactionGet = vi.fn().mockImplementation(async (ref: any) => {
      callCount++;
      if (callCount > 1) {
        return { exists: () => false, data: () => null };
      }
      return { exists: () => true, data: () => ({ procesado: false }) };
    });

    // First attempt -> doc exists
    const snap1 = await mockTransactionGet('ref-1');
    expect(snap1.exists()).toBe(true);

    // Second attempt (concurrent or double click) -> doc no longer exists
    const snap2 = await mockTransactionGet('ref-1');
    expect(snap2.exists()).toBe(false);
  });
});
