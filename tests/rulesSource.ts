import { readFileSync } from 'node:fs';

const ALLOWLIST = /(function isAllowedUser\(\) \{\s*return request\.auth\.uid in )\[([^\]]*)\]/;

/** UIDs listed in isAllowedUser() of the published rules. */
export function rulesAllowedUids(): string[] {
  const match = ALLOWLIST.exec(readFileSync('firestore.rules', 'utf8'));
  if (!match) throw new Error('isAllowedUser() not found in firestore.rules');
  return [...match[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * The rules with the test accounts added to the allowlist, so the other suites can keep using
 * readable ids. Ids not passed here (e.g. 'stranger') stay out, like any foreign account.
 */
export function rulesForTests(testUids: string[]): string {
  const rules = readFileSync('firestore.rules', 'utf8');
  if (!ALLOWLIST.test(rules)) throw new Error('isAllowedUser() not found in firestore.rules');
  const uids = [...rulesAllowedUids(), ...testUids].map((uid) => `'${uid}'`).join(', ');
  return rules.replace(ALLOWLIST, `$1[${uids}]`);
}
