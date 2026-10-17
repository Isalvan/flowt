// Signed-out visitors to "/" see the public landing; "/entrar" is the sign-in screen it links to.

export const SIGN_IN_PATH = '/entrar';
// Vite's dev server answers "/landing/" with the app shell, so point at the file there.
export const LANDING_URL = import.meta.env.DEV ? '/landing/index.html' : '/landing/';

// Set while a real account is signed in, so the landing redirect can run before React and Firebase load.
const SIGNED_IN_HINT = 'flowt:signed-in';

export function rememberSignedIn(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(SIGNED_IN_HINT, '1');
    else localStorage.removeItem(SIGNED_IN_HINT);
  } catch {
    // Storage blocked: the visitor simply sees the landing next time.
  }
}

function hasSignedInHint(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_HINT) === '1';
  } catch {
    return false;
  }
}

function isInstalledApp(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** The installed app and anyone who has signed in before go straight to Flowt. */
export function shouldOpenLanding(): boolean {
  return window.location.pathname === '/' && !hasSignedInHint() && !isInstalledApp();
}
