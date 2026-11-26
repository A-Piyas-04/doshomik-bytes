import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/theme/theme';

export interface TapProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** How the pressed state shows: dim the content, or fill the row. */
  feedback?: 'opacity' | 'fill' | 'none';
}

/** Every interactive element has a visible pressed state (spec §2.5). */
export function Tap({ style, feedback = 'opacity', ...rest }: TapProps) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      {...rest}
      style={({ pressed }) => [
        style,
        pressed && feedback === 'opacity' ? { opacity: 0.6 } : null,
        pressed && feedback === 'fill' ? { backgroundColor: colors.surface } : null,
      ]}
    />
  );
}
