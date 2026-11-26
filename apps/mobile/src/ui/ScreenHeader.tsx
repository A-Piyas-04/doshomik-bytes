import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { CaretLeft, X } from './icons';

interface ScreenHeaderProps {
  title?: string;
  /** Show a back button (pushed screens) or a close button (modals). */
  leading?: 'back' | 'close' | 'none';
  onLeading?: () => void;
  right?: ReactNode;
  /** Draw a hairline under the header. */
  divider?: boolean;
  /** Skip the top safe-area inset (inside sheets). */
  noInset?: boolean;
  /** Match a screen that reads on the white surface (paper, lesson). */
  surface?: boolean;
}

/** The header of every pushed screen: back, a left-aligned title, up to two actions. */
export function ScreenHeader({ title, leading = 'back', onLeading, right, divider = true, noInset, surface }: ScreenHeaderProps) {
  const colors = useColors();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const goBack = onLeading ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: noInset ? 0 : insets.top, backgroundColor: surface ? colors.surface : colors.bg, borderBottomColor: divider ? colors.border : 'transparent' },
      ]}
    >
      <View style={styles.row}>
        {leading === 'none' ? (
          <View style={styles.spacer} />
        ) : (
          <IconButton icon={leading === 'back' ? CaretLeft : X} label={t(leading === 'back' ? 'a11y.back' : 'common.close')} onPress={goBack} />
        )}
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.title} accessibilityRole="header">
          {title ?? ''}
        </AppText>
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { height: layout.headerHeight, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs },
  spacer: { width: space.md },
  title: { flex: 1, marginLeft: space.xs },
  right: { flexDirection: 'row', alignItems: 'center' },
});
