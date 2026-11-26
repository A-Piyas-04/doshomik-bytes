import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useT } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { WifiSlash, type IconComponent } from './icons';

interface EmptyStateProps {
  icon: IconComponent;
  message: string;
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Empty: an icon, one line of explanation, one action. */
export function EmptyState({ icon: Icon, title, message, actionLabel, onAction, secondaryLabel, onSecondary, style }: EmptyStateProps) {
  const colors = useColors();
  return (
    <View style={[styles.box, style]}>
      <Icon size={32} color={colors.textTertiary} weight="regular" />
      {title ? (
        <AppText variant="title" align="center">
          {title}
        </AppText>
      ) : null}
      <AppText variant="body" tone="textSecondary" align="center" style={styles.message}>
        {message}
      </AppText>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} kind="secondary" size="sm" /> : null}
      {secondaryLabel && onSecondary ? <Button label={secondaryLabel} onPress={onSecondary} kind="ghost" size="sm" /> : null}
    </View>
  );
}

/** Error: what failed and a Retry. Offline gets its own icon. */
export function ErrorState({ onRetry, offline, style }: { onRetry: () => void; offline?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useT();
  const colors = useColors();
  return (
    <View style={[styles.box, style]}>
      <WifiSlash size={28} color={colors.textTertiary} />
      <AppText variant="bodyStrong" align="center">
        {offline ? t('common.offline') : t('common.errorTitle')}
      </AppText>
      <AppText variant="caption" tone="textSecondary" align="center">
        {t('common.errorBody')}
      </AppText>
      <Button label={t('common.retry')} onPress={onRetry} kind="secondary" size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: layout.screenPadding * 2, paddingVertical: space.x5 },
  message: { maxWidth: 320 },
});
