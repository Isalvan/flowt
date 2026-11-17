import { App } from '@capacitor/app';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { installWebShare } from './webShare';

/** An open sheet or dialog: every Flowt modal locks page scroll or marks itself aria-modal. */
function overlayOpen(): boolean {
  return document.body.style.overflow === 'hidden' || document.querySelector('[aria-modal="true"]') !== null;
}

function syncSystemBars(): void {
  const dark = document.documentElement.classList.contains('dark');
  void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
}

/**
 * App-only behaviour around the web layer:
 * - Android's back gesture closes the open sheet (through the same Escape handling the
 *   keyboard uses), then goes back in history, and only then leaves the app.
 * - Status and navigation bar icons follow the light or dark theme.
 * - navigator.share opens Android's share sheet.
 */
export function startNativeShell(): void {
  installWebShare();
  void App.addListener('backButton', ({ canGoBack }) => {
    if (overlayOpen()) {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } else if (canGoBack) {
      window.history.back();
    } else {
      void App.minimizeApp();
    }
  });
  syncSystemBars();
  new MutationObserver(syncSystemBars).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
