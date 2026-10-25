import type { CapacitorConfig } from '@capacitor/cli';

// Android app for the demo. The UI talks to the server laptop over plain http on the local network, so the app is
// served as http://localhost (no mixed-content blocking) and cleartext traffic is allowed.
const config: CapacitorConfig = {
  appId: 'com.githappens.rakshak',
  appName: 'RAKSHAK',
  webDir: 'dist',
  backgroundColor: '#07070b',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    // Keep the web view inside the system bars; light icons on the dark background.
    SystemBars: { insetsHandling: 'css', style: 'DARK' },
    // The web view shrinks above the keyboard, so the chat composer stays visible while typing.
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    LocalNotifications: { smallIcon: 'ic_stat_rakshak', iconColor: '#0A84FF' },
  },
};

export default config;
