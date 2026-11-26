import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/theme/theme';
import type { Palette } from '@/theme/tokens';
import type { IconComponent, IconWeight } from './icons';
import { Tap } from './Tap';

export interface IconButtonProps {
  icon: IconComponent;
  /** Required: icon-only controls must say what they do, in the active language. */
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  tone?: keyof Palette;
  color?: string;
  weight?: IconWeight;
  /** A small accent dot (unread). */
  dot?: boolean;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A 44×44 touch target around a glyph of any size. */
export function IconButton({ icon: Icon, label, onPress, onLongPress, size = 24, tone = 'text', color, weight = 'regular', dot, disabled, selected, style }: IconButtonProps) {
  const colors = useColors();
  return (
    <Tap
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      hitSlop={4}
      style={[styles.box, disabled ? styles.disabled : null, style]}
    >
      <Icon size={size} color={color ?? colors[tone]} weight={weight} />
      {dot ? <View style={[styles.dot, { backgroundColor: colors.alert, borderColor: colors.bg }]} /> : null}
    </Tap>
  );
}

const styles = StyleSheet.create({
  box: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  dot: { position: 'absolute', top: 9, right: 9, width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
});
