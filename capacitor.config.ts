import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.grasschecker.app',
  appName: 'Grasschecker',
  webDir: 'dist',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
