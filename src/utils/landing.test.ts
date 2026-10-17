import { afterEach, describe, expect, it } from 'vitest';
import { rememberSignedIn, shouldOpenLanding } from './landing';

describe('landing redirect', () => {
  afterEach(() => {
    rememberSignedIn(false);
    window.history.replaceState(null, '', '/');
  });

  it('sends a signed-out visitor at "/" to the landing', () => {
    window.history.replaceState(null, '', '/');
    expect(shouldOpenLanding()).toBe(true);
  });

  it('lets someone who signed in before go straight to the app', () => {
    rememberSignedIn(true);
    expect(shouldOpenLanding()).toBe(false);
  });

  it('never redirects the sign-in screen or other paths', () => {
    window.history.replaceState(null, '', '/entrar');
    expect(shouldOpenLanding()).toBe(false);
    window.history.replaceState(null, '', '/docs');
    expect(shouldOpenLanding()).toBe(false);
  });

  it('shows the landing again after signing out', () => {
    rememberSignedIn(true);
    rememberSignedIn(false);
    expect(shouldOpenLanding()).toBe(true);
  });
});
