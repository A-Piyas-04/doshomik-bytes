import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from './AppText';
import { Tap } from './Tap';

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedTabsProps<T extends string> {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Spread the tabs over the full width (Home, Library) or keep them left-aligned (paper). */
  stretch?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Text tabs with a 2 dp accent underline under the selected one: the one pattern for
 * tabs-inside-a-screen (Home's Feed | Research, the paper's sections, Library, Profile, search).
 */
export function SegmentedTabs<T extends string>({ options, value, onChange, stretch = true, style }: SegmentedTabsProps<T>) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { borderBottomColor: colors.divider }, stretch ? null : styles.compact, style]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Tap
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.tab, stretch ? styles.stretch : null]}
          >
            <AppText variant="label" weight={selected ? 'semibold' : 'medium'} tone={selected ? 'text' : 'textTertiary'} numberOfLines={1}>
              {option.label}
            </AppText>
            <View style={[styles.underline, { backgroundColor: selected ? colors.accent : 'transparent' }]} />
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  compact: { paddingHorizontal: layout.screenPadding - space.md, gap: space.xs },
  tab: { height: 44, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  stretch: { flex: 1 },
  underline: { position: 'absolute', bottom: -StyleSheet.hairlineWidth, left: space.md, right: space.md, height: 2, borderRadius: 1 },
});
