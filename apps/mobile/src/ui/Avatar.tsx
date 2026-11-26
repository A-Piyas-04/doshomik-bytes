import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePersonColor } from '@/theme/area';
import { useColors } from '@/theme/theme';
import { AppText } from './AppText';

interface AvatarProps {
  url: string | null | undefined;
  name: string;
  /** 32 comment · 40 feed and lists · 48 notifications · 88 profile. */
  size?: 24 | 28 | 32 | 36 | 40 | 48 | 56 | 64 | 88;
  /** A coloured ring around the picture (suggestions, profile). */
  ring?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]!][0] ?? '';
  const second = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return (first + second).toUpperCase();
}

/**
 * Always circular. Without a photo, the initials sit on a colour of their own (stable per name), so
 * a list of people reads as a crowd, not a column of grey dots.
 */
export const Avatar = memo(function Avatar({ url, name, size = 40, ring }: AvatarProps) {
  const colors = useColors();
  const person = usePersonColor(name);
  const box = { width: size, height: size, borderRadius: size / 2 };
  const inner = url ? (
    <Image
      source={{ uri: url }}
      style={[box, { backgroundColor: colors.elevated }]}
      contentFit="cover"
      transition={120}
      recyclingKey={url}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <View style={[box, styles.fallback, { backgroundColor: person.solid }]}>
      <AppText variant="label" weight="bold" style={{ color: person.on, fontSize: Math.round(size * 0.36), lineHeight: Math.round(size * 0.46) }}>
        {initials(name)}
      </AppText>
    </View>
  );
  if (!ring) return inner;
  const outer = size + 8;
  return (
    <View style={[styles.ring, { width: outer, height: outer, borderRadius: outer / 2, borderColor: ring }]}>
      <View style={[styles.gapRing, { borderColor: colors.surface, borderRadius: (size + 4) / 2 }]}>{inner}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  gapRing: { borderWidth: 2 },
});
