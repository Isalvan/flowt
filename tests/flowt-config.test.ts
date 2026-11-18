import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { applyConfig } from '../scripts/apply-config.mjs';

describe('flowt.config.json', () => {
  it('is copied into every file that needs its values', () => {
    // If this fails, run: npm run config:apply
    expect(applyConfig({ check: true })).toEqual([]);
  });
});
