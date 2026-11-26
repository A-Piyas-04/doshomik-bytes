import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useColors } from '@/theme/theme';
import { AppText } from './AppText';

interface AvatarProps {
  url: string | null | undefined;
  name: string;
  /** 32 comment · 40 feed and lists · 48 notifications · 88 profile. */
  size?: 24 | 32 | 40 | 48 | 64 | 88;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]!][0] ?? '';
  const second = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return (first + second).toUpperCase();
}

/** Always circular, with an initials fallback on an accent-tinted circle. */
export const Avatar = memo(function Avatar({ url, name, size = 40 }: AvatarProps) {
  const colors = useColors();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[box, { backgroundColor: colors.elevated }]}
        contentFit="cover"
        transition={120}
        recyclingKey={url}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[box, styles.fallback, { backgroundColor: colors.accentWash, borderColor: colors.border }]}>
      <AppText variant={size >= 64 ? 'title' : size >= 40 ? 'label' : 'micro'} tone="accent" weight="semibold">
        {initials(name)}
      </AppText>
    </View>
  );
});

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
