import type { CapacitorConfig } from '@capacitor/cli';

// The Android app wraps the same Vite build as the web (dist/). Keep appId stable:
// Firebase, the signing key and Google sign-in are all registered against it.
const config: CapacitorConfig = {
  appId: 'com.isalvan.flowt',
  appName: 'Flowt',
  webDir: 'dist',
  server: {
    // Serve the bundled files as https://flowt-63536.web.app instead of https://localhost, so
    // the app sends the same Origin and Referer as the website. The Firebase web API key only
    // accepts the site as referrer, and the Worker's CORS already allows it (APP_URL).
    // Requests to this host never reach the network: Capacitor answers them from the APK.
    hostname: 'flowt-63536.web.app',
    androidScheme: 'https',
  },
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
