import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { usePrefs } from '@/lib/prefs';
import { brandColors, motion } from '@/theme/tokens';

const MARK = require('../../assets/brand/mark-512.png');
const LOCKUP = { en: require('../../assets/brand/lockup-en-light.png'), bn: require('../../assets/brand/lockup-bn-light.png') };
const LOCKUP_RATIO = { en: 720 / 193, bn: 720 / 334 };

/** The brand moment lasts at least this long on a cold start, so the logos are seen, not flashed. */
const MIN_VISIBLE_MS = 900;

/**
 * The loading screen: the square mark (exactly where the native splash put it), then the wordmark
 * rises in beneath it while fonts, preferences and the cached data load. It fades out over the
 * app, which is already mounted underneath, so deep links resolve during loading.
 */
export function AppLoader({ ready }: { ready: boolean }) {
  const reduced = useReducedMotion();
  const lang = usePrefs((s) => (s.hydrated ? s.lang : 'en'));
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);
  const lockup = useSharedValue(0);

  useEffect(() => {
    // Our first frame matches the native splash, so hide it now and take over.
    void SplashScreen.hideAsync().catch(() => undefined);
    lockup.set(withDelay(reduced ? 0 : 120, withTiming(1, { duration: reduced ? 0 : motion.loader * 1.6, easing: Easing.out(Easing.cubic) })));
    const timer = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [lockup, reduced]);

  const lockupStyle = useAnimatedStyle(() => ({
    opacity: lockup.get(),
    transform: [{ translateY: (1 - lockup.get()) * 10 }],
  }));

  const done = ready && minElapsed;
  const overlay = useSharedValue(1);
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.get() }));
  useEffect(() => {
    if (!done) return;
    overlay.set(withTiming(0, { duration: motion.screen, easing: Easing.in(Easing.quad) }));
    const timer = setTimeout(() => setGone(true), motion.screen + 40);
    return () => clearTimeout(timer);
  }, [done, overlay]);

  if (gone) return null;
  const width = 176;
  return (
    <Animated.View
      pointerEvents={done ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, styles.root, overlayStyle]}
      accessibilityLabel="Doshomik Bytes"
      testID={done ? 'app-ready' : 'app-loading'}
    >
      <View style={styles.center}>
        <Image source={MARK} style={styles.mark} contentFit="contain" />
        <Animated.View style={lockupStyle}>
          <Image source={LOCKUP[lang]} style={{ width, height: width / LOCKUP_RATIO[lang] }} contentFit="contain" />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: brandColors.ink, zIndex: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  mark: { width: 120, height: 120 },
});
