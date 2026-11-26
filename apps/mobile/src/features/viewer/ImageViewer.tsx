import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { IconButton } from '@/ui/IconButton';
import { X } from '@/ui/icons';

/**
 * A figure or diagram, full screen: pinch to zoom, drag to pan, double-tap to zoom in or reset.
 * Built on Gesture Handler and Reanimated; no extra dependency.
 */
export function ImageViewer({ url }: { url: string }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.set(Math.min(5, Math.max(1, savedScale.get() * e.scale)));
    })
    .onEnd(() => {
      savedScale.set(scale.get());
    });
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.get() <= 1) return;
      x.set(savedX.get() + e.translationX);
      y.set(savedY.get() + e.translationY);
    })
    .onEnd(() => {
      savedX.set(x.get());
      savedY.set(y.get());
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.get() > 1 ? 1 : 2.5;
      scale.set(withTiming(next));
      savedScale.set(next);
      if (next === 1) {
        x.set(withTiming(0));
        y.set(withTiming(0));
        savedX.set(0);
        savedY.set(0);
      }
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));

  return (
    <View style={styles.root}>
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
        <Animated.View style={[styles.fill, style]}>
          <Image source={{ uri: url }} style={styles.fill} contentFit="contain" />
        </Animated.View>
      </GestureDetector>
      <View style={[styles.close, { top: insets.top + 4 }]}>
        <IconButton icon={X} color="#FFFFFF" label={t('common.close')} onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(8,9,12,0.96)' },
  fill: { flex: 1 },
  close: { position: 'absolute', right: 8 },
});
