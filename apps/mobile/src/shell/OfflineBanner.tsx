import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useT } from '@/i18n';
import { useConnectionPhase } from '@/lib/connection';
import { useColors } from '@/theme/theme';
import { layout, motion, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { WifiHigh, WifiSlash } from '@/ui/icons';

/**
 * A slim full-width strip directly above the tab bar, as in other Android apps: ink while
 * offline ("You're offline. Showing what was saved."), teal for a moment when the connection
 * returns. It takes its own space in the layout, so it never covers content. Its state lives in
 * `lib/connection.ts`.
 */
export function OfflineBanner() {
  const t = useT();
  const colors = useColors();
  const phase = useConnectionPhase((s) => s.phase);
  if (phase === 'hidden') return null;

  const offline = phase === 'offline';
  const fg = offline ? colors.onInverse : colors.onAccent;
  const Icon = offline ? WifiSlash : WifiHigh;
  return (
    <Animated.View
      entering={FadeIn.duration(motion.state)}
      exiting={FadeOut.duration(motion.state)}
      accessibilityLiveRegion="polite"
      style={[styles.strip, { backgroundColor: offline ? colors.inverse : colors.accent }]}
    >
      <Icon size={16} color={fg} weight="bold" />
      <AppText variant="label" weight="semibold" style={[styles.text, { color: fg }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {offline ? t('common.offline') : t('common.backOnline')}
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: layout.offlineStripHeight,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.xs,
  },
  text: { flexShrink: 1 },
});
