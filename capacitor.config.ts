import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.grasschecker.app',
  appName: 'Grasschecker',
  webDir: 'dist',
  backgroundColor: '#09090b',
  ios: {
    contentInset: 'never',
    backgroundColor: '#09090b',
    preferredContentMode: 'mobile',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#09090b',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#00000000',
    },
  },
};

export default config;
