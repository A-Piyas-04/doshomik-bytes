import { memo } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from './AppText';
import type { IconComponent } from './icons';
import { Tap } from './Tap';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** Fill and text colour when selected (learn areas); ink otherwise. */
  color?: { solid: string; on: string };
  icon?: IconComponent;
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: { solid: string; on: string };
  icon?: IconComponent;
}

/** A filter chip: white with a hairline border; the selected one is filled with ink. Radius 8, never a pill. */
export const Chip = memo(function Chip({ label, selected, onPress, color, icon: Icon }: ChipProps) {
  const colors = useColors();
  const fill = color?.solid ?? colors.inverse;
  const text = selected ? (color?.on ?? colors.onInverse) : colors.text;
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { borderColor: selected ? fill : colors.border, backgroundColor: selected ? fill : colors.surface }]}
    >
      {Icon ? <Icon size={15} weight={selected ? 'fill' : 'bold'} color={selected ? text : (color?.solid ?? colors.textSecondary)} /> : null}
      <AppText variant="label" weight="semibold" style={{ color: text }} numberOfLines={1}>
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
    <Chip key={option.value} label={option.label} color={option.color} icon={option.icon} selected={option.value === value} onPress={() => onChange(option.value)} />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  row: { paddingHorizontal: layout.screenPadding, gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
