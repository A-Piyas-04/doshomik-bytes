import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptics only where the spec allows them: like, follow, saving a paper, submitting a practice
 * answer and pull-to-refresh. Nothing else; a buzz on every tap is noise.
 */
export function tick(): void {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function success(): void {
  if (Platform.OS === 'web') return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function warning(): void {
  if (Platform.OS === 'web') return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
