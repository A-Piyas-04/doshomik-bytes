import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { AppText } from './AppText';
import type { IconComponent } from './icons';
import { Tap } from './Tap';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  kind?: Kind;
  size?: 'md' | 'sm';
  icon?: IconComponent;
  /** Icon after the label (external links). */
  trailingIcon?: IconComponent;
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to the parent's width. */
  block?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Buttons. One primary per view. Radius 8 (never a pill). Secondary is an outlined surface, ghost is
 * text only (for low-emphasis actions inside rows).
 */
export function Button({
  label,
  onPress,
  kind = 'primary',
  size = 'md',
  icon: Icon,
  trailingIcon: Trailing,
  disabled,
  loading,
  block,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const colors = useColors();
  const fg =
    kind === 'primary' ? colors.onAccent : kind === 'danger' ? colors.danger : kind === 'ghost' ? colors.accent : colors.text;
  const container: ViewStyle =
    kind === 'primary'
      ? { backgroundColor: colors.accent }
      : kind === 'ghost'
        ? { backgroundColor: 'transparent' }
        : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth * 2 };
  const height = size === 'md' ? 44 : 36;
  const inactive = disabled || loading;

  return (
    <Tap
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={[
        styles.base,
        { height, paddingHorizontal: kind === 'ghost' ? space.sm : size === 'md' ? space.lg : space.md },
        container,
        block ? styles.block : null,
        inactive ? styles.inactive : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={18} color={fg} weight="bold" /> : null}
          <AppText variant={size === 'md' ? 'bodyStrong' : 'label'} weight="semibold" style={{ color: fg }} numberOfLines={1}>
            {label}
          </AppText>
          {Trailing ? <Trailing size={16} color={fg} weight="bold" /> : null}
        </View>
      )}
    </Tap>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  block: { alignSelf: 'stretch' },
  inactive: { opacity: 0.45 },
  content: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
