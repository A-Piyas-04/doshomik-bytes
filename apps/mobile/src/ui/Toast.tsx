import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useConnectionPhase } from '@/lib/connection';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from './AppText';
import { Tap } from './Tap';

interface ToastState {
  message: string | null;
  tone: 'info' | 'error';
  actionLabel?: string;
  onAction?: () => void;
  id: number;
}

const useToastStore = create<ToastState>(() => ({ message: null, tone: 'info', id: 0 }));

/** A short message above the tab bar. Errors from optimistic updates use tone 'error'. */
export function toast(message: string, options: { tone?: 'info' | 'error'; actionLabel?: string; onAction?: () => void } = {}) {
  useToastStore.setState((s) => ({ message, tone: options.tone ?? 'info', actionLabel: options.actionLabel, onAction: options.onAction, id: s.id + 1 }));
}

export function ToastHost() {
  const { message, tone, actionLabel, onAction, id } = useToastStore();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // Sit above the offline strip while it shows: failed actions are most likely just then.
  const strip = useConnectionPhase((s) => (s.phase === 'hidden' ? 0 : layout.offlineStripHeight));

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => useToastStore.setState({ message: null }), actionLabel ? 5000 : 2800);
    return () => clearTimeout(timer);
  }, [message, id, actionLabel]);

  if (!message) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + layout.tabBarHeight + strip + space.md }]}>
      <Animated.View
        key={id}
        entering={FadeInDown.duration(180)}
        exiting={FadeOutDown.duration(150)}
        accessibilityLiveRegion="polite"
        style={[styles.toast, { backgroundColor: colors.text, borderColor: tone === 'error' ? colors.danger : colors.text }]}
      >
        <AppText variant="label" style={{ color: colors.bg, flex: 1 }}>
          {message}
        </AppText>
        {actionLabel && onAction ? (
          <Tap
            onPress={() => {
              onAction();
              useToastStore.setState({ message: null });
            }}
            style={styles.action}
          >
            <AppText variant="label" weight="semibold" style={{ color: colors.bg }}>
              {actionLabel}
            </AppText>
          </Tap>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: layout.screenPadding, right: layout.screenPadding, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    maxWidth: 480,
    alignSelf: 'stretch',
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  action: { paddingVertical: space.xs, paddingHorizontal: space.xs },
});
