import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';

/** A block of the loading skeleton: the real layout's shape, gently pulsing. */
export function Bone({ width = '100%', height = 14, round, style }: { width?: DimensionValue; height?: number; round?: boolean; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[{ width, height, borderRadius: round ? height / 2 : radius.xs, backgroundColor: colors.elevated }, style]} />;
}

/** Pulses its children's opacity. Respects reduced motion (stays still). */
export function Pulse({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const phase = useSharedValue(0);
  useEffect(() => {
    if (!reduced) phase.set(withRepeat(withTiming(1, { duration: 900 }), -1, true));
  }, [phase, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: 1 - phase.get() * 0.45 }));
  return (
    <Animated.View style={[style, animated]} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {children}
    </Animated.View>
  );
}

/** Skeleton for a list of text rows (papers, trails, notifications). */
export function RowsSkeleton({ rows = 5, avatar }: { rows?: number; avatar?: boolean }) {
  return (
    <Pulse style={styles.list}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.row}>
          {avatar ? <Bone width={40} height={40} round /> : null}
          <View style={styles.lines}>
            <Bone width="30%" height={10} />
            <Bone width="90%" height={16} />
            <Bone width="70%" height={12} />
          </View>
        </View>
      ))}
    </Pulse>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, gap: space.xxl },
  row: { flexDirection: 'row', gap: space.md },
  lines: { flex: 1, gap: space.sm },
});
