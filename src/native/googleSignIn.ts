import { GoogleAuthProvider, signInWithCredential, signInWithPopup, type Auth, type UserCredential } from 'firebase/auth';
import { isNativeApp } from './platform';

/**
 * Google sign-in for both the web and the app. Google blocks its sign-in page inside
 * embedded web views, so the app asks Android for a Google ID token (Credential Manager)
 * and hands it to the Firebase JS SDK, which keeps owning the session exactly as on the web.
 */
export async function signInWithGoogle(auth: Auth, { selectAccount = false } = {}): Promise<UserCredential> {
  if (!isNativeApp()) {
    const provider = new GoogleAuthProvider();
    if (selectAccount) provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(auth, provider);
  }
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  // Forget the last Google account so the picker always shows, as `select_account` does on the web.
  if (selectAccount) await FirebaseAuthentication.signOut().catch(() => undefined);
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) throw new Error('Google no ha devuelto credenciales.');
  return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
}

/** Also forgets the Google account on the device, so the next sign-in can pick another one. */
export async function signOutOfGoogle(): Promise<void> {
  if (!isNativeApp()) return;
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  await FirebaseAuthentication.signOut().catch(() => undefined);
}
