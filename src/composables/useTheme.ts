import { useDark, useToggle } from '@vueuse/core';
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

export function useTheme() {
  return {
    isDark,
    toggleTheme,
  };
}
