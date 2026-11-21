import { describe, expect, it } from 'vitest';
import { median } from './median';

describe('median', () => {
  it('takes the middle value of an odd list, in any order', () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it('averages the two middle values of an even list', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('leaves the input untouched', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});
