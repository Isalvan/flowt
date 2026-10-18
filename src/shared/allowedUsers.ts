import type { User } from 'firebase/auth';
import allowedUids from './allowedUids.json';

/**
 * Las únicas cuentas que pueden usar Flowt: la de Google del propietario y la de acceso manual.
 * Debe coincidir con isAllowedUser() de firestore.rules (un test lo comprueba); el conector MCP
 * lee la misma lista.
 */
export const ALLOWED_UIDS: readonly string[] = allowedUids;

export const isAllowedUser = (user: Pick<User, 'uid'> | null | undefined): boolean =>
  !!user && ALLOWED_UIDS.includes(user.uid);
