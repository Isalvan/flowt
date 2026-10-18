import { describe, expect, it } from 'vitest';
import { ALLOWED_UIDS, isAllowedUser } from '../src/shared/allowedUsers';
import { rulesAllowedUids } from './rulesSource';

describe('allowed users', () => {
  it('matches the allowlist in firestore.rules', () => {
    expect(rulesAllowedUids()).toEqual([...ALLOWED_UIDS]);
    expect(ALLOWED_UIDS).toHaveLength(2);
  });

  it('accepts only the listed accounts', () => {
    expect(isAllowedUser({ uid: ALLOWED_UIDS[0] })).toBe(true);
    expect(isAllowedUser({ uid: ALLOWED_UIDS[1] })).toBe(true);
    expect(isAllowedUser({ uid: 'stranger' })).toBe(false);
    expect(isAllowedUser(null)).toBe(false);
  });
});
