import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from './AppText';
import { KeyboardView } from './Keyboard';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the scrolling content (primary action). */
  footer?: ReactNode;
  /** Cap the height (fraction of the screen). */
  maxHeight?: `${number}%`;
}

/**
 * A bottom sheet on a native Modal: scrim, rounded top, grabber, title, scrolling body, pinned
 * footer, and keyboard avoidance for inputs. Android Back and a tap on the scrim close it.
 */
export function BottomSheet({ visible, onClose, title, subtitle, children, footer, maxHeight = '85%' }: BottomSheetProps) {
  const colors = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.close')} />
      </Animated.View>
      <KeyboardView style={styles.anchor}>
        <View style={styles.anchor} pointerEvents="box-none">
          <Animated.View
            entering={SlideInDown.duration(240)}
            style={[styles.sheet, { maxHeight, backgroundColor: colors.bg, borderColor: colors.border, paddingBottom: insets.bottom + space.sm }]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            {title ? (
              <View style={styles.header}>
                <AppText variant="title" accessibilityRole="header">
                  {title}
                </AppText>
                {subtitle ? (
                  <AppText variant="caption" tone="textSecondary">
                    {subtitle}
                  </AppText>
                ) : null}
              </View>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} bounces={false}>
              {children}
            </ScrollView>
            {footer ? <View style={[styles.footer, { borderTopColor: colors.divider }]}>{footer}</View> : null}
          </Animated.View>
        </View>
      </KeyboardView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.sm },
  header: { paddingHorizontal: layout.screenPadding, paddingTop: space.sm, paddingBottom: space.md, gap: space.xs },
  body: { paddingBottom: space.md },
  footer: { paddingHorizontal: layout.screenPadding, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
