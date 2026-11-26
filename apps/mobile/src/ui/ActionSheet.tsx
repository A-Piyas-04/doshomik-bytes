import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { translate } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from './AppText';
import type { IconComponent } from './icons';
import { Tap } from './Tap';

export interface SheetAction {
  label: string;
  icon?: IconComponent;
  destructive?: boolean;
  onPress: () => void;
}

interface SheetRequest {
  title?: string;
  message?: string;
  actions: SheetAction[];
}

const useSheetStore = create<{ request: SheetRequest | null }>(() => ({ request: null }));

/** The ⋯ menu: a short list of actions in a bottom sheet. Works the same on Android, iOS and web. */
export function showActions(request: SheetRequest) {
  useSheetStore.setState({ request });
}

/** A confirmation before a destructive or lossy action. Resolves true when confirmed. */
export function confirm(options: { title: string; message?: string; confirmLabel: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    showActions({
      title: options.title,
      message: options.message,
      actions: [
        { label: options.confirmLabel, destructive: options.destructive, onPress: () => resolve(true) },
        { label: translate('common.cancel'), onPress: () => resolve(false) },
      ],
    });
    pendingCancel = () => resolve(false);
  });
}

let pendingCancel: (() => void) | null = null;

function close(cancelled: boolean) {
  if (cancelled) pendingCancel?.();
  pendingCancel = null;
  useSheetStore.setState({ request: null });
}

export function ActionSheetHost() {
  const request = useSheetStore((s) => s.request);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!request) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => close(true)}>
      <Animated.View entering={FadeIn.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close(true)} accessibilityLabel={translate('common.close')} />
      </Animated.View>
      <View style={styles.anchor} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(220)}
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + space.sm }]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          {request.title ? (
            <View style={styles.header}>
              <AppText variant="bodyStrong">{request.title}</AppText>
              {request.message ? (
                <AppText variant="caption" tone="textSecondary">
                  {request.message}
                </AppText>
              ) : null}
            </View>
          ) : null}
          {request.actions.map((action, index) => {
            const Icon = action.icon;
            const color = action.destructive ? colors.danger : colors.text;
            return (
              <Tap
                key={action.label}
                feedback="fill"
                onPress={() => {
                  pendingCancel = null;
                  close(false);
                  action.onPress();
                }}
                style={[styles.action, index > 0 || request.title ? { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth } : null]}
              >
                {Icon ? <Icon size={22} color={color} /> : null}
                <AppText variant="body" weight={action.destructive ? 'semibold' : 'regular'} style={{ color }}>
                  {action.label}
                </AppText>
              </Tap>
            );
          })}
        </Animated.View>
      </View>
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
    maxWidth: 560,
    alignSelf: 'center',
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.sm },
  header: { paddingHorizontal: layout.screenPadding, paddingVertical: space.md, gap: space.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: layout.screenPadding },
});
