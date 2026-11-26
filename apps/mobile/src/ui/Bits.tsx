import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from './AppText';
import { CaretRight, type IconComponent } from './icons';
import { Tap } from './Tap';

/** A hairline between list rows, inset to the text column. */
export function Divider({ inset = layout.screenPadding, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: inset }, style]} />;
}

/** A section label: mono, small, with an optional action on the right ("See all"). */
export function SectionLabel({ label, action, onAction, style }: { label: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      <AppText variant="meta" tone="textTertiary" accessibilityRole="header">
        {label}
      </AppText>
      {action && onAction ? (
        <Tap onPress={onAction} hitSlop={12}>
          <AppText variant="label" tone="accent">
            {action}
          </AppText>
        </Tap>
      ) : null}
    </View>
  );
}

interface NavRowProps {
  title: string;
  subtitle?: string;
  icon?: IconComponent;
  onPress: () => void;
  trailing?: ReactNode;
  /** Draw the chevron (navigation) — off for rows that act in place. */
  chevron?: boolean;
  accessibilityHint?: string;
}

/** A tappable row: icon, title, one line of explanation, chevron. Used for doors to other screens. */
export function NavRow({ title, subtitle, icon: Icon, onPress, trailing, chevron = true, accessibilityHint }: NavRowProps) {
  const colors = useColors();
  return (
    <Tap feedback="fill" onPress={onPress} accessibilityHint={accessibilityHint} style={styles.navRow}>
      {Icon ? (
        <View style={[styles.navIcon, { borderColor: colors.border }]}>
          <Icon size={20} color={colors.text} />
        </View>
      ) : null}
      <View style={styles.navText}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
      {chevron ? <CaretRight size={16} color={colors.textTertiary} /> : null}
    </Tap>
  );
}

/** The small spinner at the end of a list while the next page loads. */
export function ListFooter({ loading, done, doneLabel }: { loading: boolean; done?: boolean; doneLabel?: string }) {
  const colors = useColors();
  if (loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  }
  if (done && doneLabel) {
    return (
      <View style={styles.footer}>
        <AppText variant="caption" tone="textTertiary">
          {doneLabel}
        </AppText>
      </View>
    );
  }
  return <View style={styles.footerSpace} />;
}

/**
 * A small badge on a wash: mint for reading state ("✓ Explored"), amber for New/Trending, neutral
 * for Draft or a language. `icon` goes before the label.
 */
export function Tag({ label, tone = 'neutral', icon: Icon }: { label: string; tone?: 'neutral' | 'accent' | 'highlight' | 'danger'; icon?: IconComponent }) {
  const colors = useColors();
  const bg = tone === 'accent' ? colors.accentWash : tone === 'highlight' ? colors.highlightWash : colors.elevated;
  const fg = tone === 'accent' ? colors.accent : tone === 'highlight' ? colors.highlightText : tone === 'danger' ? colors.danger : colors.textSecondary;
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      {Icon ? <Icon size={12} weight="bold" color={fg} /> : null}
      <AppText variant="micro" weight="semibold" style={{ color: fg }}>
        {label}
      </AppText>
    </View>
  );
}

/** A white rounded group on the grey page: rows inside are separated by hairlines. */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.xxl,
    paddingBottom: space.sm,
  },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md, minHeight: 56 },
  navIcon: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  navText: { flex: 1, gap: 2 },
  footer: { paddingVertical: space.xxl, alignItems: 'center' },
  footerSpace: { height: space.xxl },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, height: 22, borderRadius: 4, alignSelf: 'flex-start' },
  group: { marginHorizontal: layout.screenPadding, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
});
