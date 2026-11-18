import { describe, expect, it } from 'vitest';
import { ALLOWED_UIDS, isAllowedUser } from '../src/shared/allowedUsers';
import { rulesAllowedUids } from './rulesSource';

describe('allowed users', () => {
  it('matches the allowlist in firestore.rules', () => {
    expect(rulesAllowedUids()).toEqual([...ALLOWED_UIDS]);
    expect(ALLOWED_UIDS.length).toBeGreaterThan(0);
  });

  it('accepts only the listed accounts', () => {
    for (const uid of ALLOWED_UIDS) expect(isAllowedUser({ uid })).toBe(true);
    expect(isAllowedUser({ uid: 'stranger' })).toBe(false);
    expect(isAllowedUser(null)).toBe(false);
  });
});
