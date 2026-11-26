import { memo } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from './AppText';
import { Tap } from './Tap';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

/** A filter chip: white with a hairline border; the selected one is filled with ink. Radius 8, never a pill. */
export const Chip = memo(function Chip({ label, selected, onPress }: ChipProps) {
  const colors = useColors();
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        { borderColor: selected ? colors.inverse : colors.border, backgroundColor: selected ? colors.inverse : colors.surface },
      ]}
    >
      <AppText variant="label" tone={selected ? 'onInverse' : 'textSecondary'} weight={selected ? 'semibold' : 'medium'} numberOfLines={1}>
        {label}
      </AppText>
    </Tap>
  );
});

interface ChipRowProps<T extends string> {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  /** Wrap onto lines instead of scrolling (short sets inside sheets). */
  wrap?: boolean;
}

/** One horizontal row of single-choice chips: the one filter control on a list. */
export function ChipRow<T extends string>({ options, value, onChange, style, wrap }: ChipRowProps<T>) {
  const chips = options.map((option) => (
    <Chip key={option.value} label={option.label} selected={option.value === value} onPress={() => onChange(option.value)} />
  ));
  if (wrap) return <View style={[styles.wrap, style]}>{chips}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={style}
      keyboardShouldPersistTaps="handled"
    >
      {chips}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { paddingHorizontal: layout.screenPadding, gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
