import type { CapacitorConfig } from '@capacitor/cli';

// The Android app wraps the same Vite build as the web (dist/). Keep appId stable:
// Firebase, the signing key and Google sign-in are all registered against it.
const config: CapacitorConfig = {
  appId: 'com.isalvan.flowt',
  appName: 'Flowt',
  webDir: 'dist',
  // Painted behind the web layer while it loads and around it under the system bars.
  backgroundColor: '#080a10',
  android: {
    // Production builds never load plain-HTTP content.
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      // The page does not draw under the status and navigation bars (no viewport-fit=cover),
      // so Android pads the web view instead of the layout having to.
      insetsHandling: 'native',
    },
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: '#080a10',
    },
    FirebaseAuthentication: {
      // The native plugin only fetches a Google ID token; the Firebase JS SDK keeps owning the session.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
