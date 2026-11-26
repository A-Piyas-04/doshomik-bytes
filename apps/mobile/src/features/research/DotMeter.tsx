import { StyleSheet, View } from 'react-native';
import { useColors } from '@/theme/theme';

/** "2 of 4 ready" as dots: the brand dot again, one per concept. Caps at 10 dots. */
export function DotMeter({ filled, total, size = 8 }: { filled: number; total: number; size?: number }) {
  const colors = useColors();
  const count = Math.min(total, 10);
  const lit = total > 10 ? Math.round((filled / total) * 10) : filled;
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: i < lit ? colors.accent : 'transparent',
            borderWidth: 1.5,
            borderColor: i < lit ? colors.accent : colors.textTertiary,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 4, alignItems: 'center' } });
