import { watch } from 'vue';
import { useDark, useToggle } from '@vueuse/core';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { haptic } from '@/services/haptics';

/**
 * Global Dark/Light mode theme state.
 * Syncs with HTML root element (.dark class) and persists to localStorage.
 */
export const isDark = useDark({
  selector: 'html',
  attribute: 'class',
  valueDark: 'dark',
  valueLight: '',
});

const _toggleDark = useToggle(isDark);

export function toggleTheme() {
  void haptic.light();
  _toggleDark();
}

/**
 * Unified OS and Web color definitions:
 * Light:
 *  - Canvas Background: #F2F2F7 (Apple HIG System Grouped Background)
 *  - Header/Surface: #FFFFFF
 *  - Status Bar Text: DARK (Style.Light in Capacitor)
 * Dark:
 *  - Canvas Background: #09090B (Tailwind zinc-950 / Apple dark canvas)
 *  - Header/Surface: #121214 (Apple elevated surface)
 *  - Status Bar Text: LIGHT (Style.Dark in Capacitor)
 */
export function syncThemeWithOS(dark: boolean, isCameraView = false) {
  const headerBg = isCameraView ? '#000000' : dark ? '#121214' : '#ffffff';
  const pageBg = isCameraView ? '#000000' : dark ? '#09090b' : '#f2f2f7';
  const isDarkContent = isCameraView || dark;

  if (typeof document !== 'undefined') {
    // 1. Root and document body colors (avoids bounce/overscroll color mismatch)
    document.documentElement.style.backgroundColor = pageBg;
    document.documentElement.style.colorScheme = isDarkContent ? 'dark' : 'light';
    if (document.body) {
      document.body.style.backgroundColor = pageBg;
    }

    // 2. <meta name="theme-color"> for Safari toolbar / Chrome browser tab
    let themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!themeMeta) {
      themeMeta = document.createElement('meta');
      themeMeta.name = 'theme-color';
      document.head.appendChild(themeMeta);
    }
    themeMeta.removeAttribute('media');
    themeMeta.content = headerBg;

    // 3. <meta name="apple-mobile-web-app-status-bar-style">
    // 'default' = dark text on light header
    // 'black-translucent' or 'black' = white text on dark header
    let appleStatusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]') as HTMLMetaElement | null;
    if (!appleStatusBarMeta) {
      appleStatusBarMeta = document.createElement('meta');
      appleStatusBarMeta.name = 'apple-mobile-web-app-status-bar-style';
      document.head.appendChild(appleStatusBarMeta);
    }
    appleStatusBarMeta.content = isDarkContent ? 'black' : 'default';
  }

  // 4. Native Capacitor Status Bar
  if (Capacitor.isNativePlatform()) {
    try {
      void StatusBar.setStyle({
        style: isDarkContent ? Style.Dark : Style.Light,
      });
      if (Capacitor.getPlatform() === 'android') {
        void StatusBar.setBackgroundColor({ color: headerBg });
      }
    } catch {
      // plugin not ready or unavailable
    }
  }
}

// Watch theme changes and sync immediately
watch(
  isDark,
  (val) => {
    syncThemeWithOS(val);
  },
  { immediate: true },
);

export function useTheme() {
  return {
    isDark,
    toggleTheme,
    syncThemeWithOS,
  };
}
