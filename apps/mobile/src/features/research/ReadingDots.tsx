import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT, type MessageKey } from '@/i18n';
import { useColors } from '@/theme/theme';

export const STEP_LABEL: Record<1 | 2 | 3, MessageKey> = { 1: 'reading.step1', 2: 'reading.step2', 3: 'reading.step3' };

/**
 * The reading tracker as the logo's dot, three times: ○○○ not read, ●○○ Explored, ●●○ Studied,
 * ●●● Reproduced. Filled dots are mint; the label is announced, so colour never carries it alone.
 */
export const ReadingDots = memo(function ReadingDots({ step, size = 7 }: { step: number; size?: number }) {
  const colors = useColors();
  const t = useT();
  const label = step > 0 ? t(STEP_LABEL[step as 1 | 2 | 3]) : t('reading.notStarted');
  return (
    <View style={styles.row} accessible accessibilityLabel={t('reading.stepLabel', { label })}>
      {[1, 2, 3].map((n) => (
        <View
          key={n}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 1.5,
            borderColor: n <= step ? colors.accent : colors.textTertiary,
            backgroundColor: n <= step ? colors.accent : 'transparent',
          }}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 3 } });
