import { Capacitor } from '@capacitor/core';

/** True inside the Android (or iOS) app built with Capacitor, false in any browser or PWA. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
