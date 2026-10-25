import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/** Haptics must never throw (unsupported browsers, desktop) — fire and forget. */
const safe = (fn: () => Promise<void>) => fn().catch(() => {});

export const haptic = {
  light: () => safe(() => Haptics.impact({ style: ImpactStyle.Light })),
  medium: () => safe(() => Haptics.impact({ style: ImpactStyle.Medium })),
  success: () => safe(() => Haptics.notification({ type: NotificationType.Success })),
  error: () => safe(() => Haptics.notification({ type: NotificationType.Error })),
};
