import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFields } from '@/api/research';
import { useLang } from '@/i18n';
import { useAreaPalette } from '@/theme/area';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Tap } from '@/ui/Tap';
import { AreaGlyph, fieldName, shortFieldName } from '../fields';

/**
 * The learn areas as a row of coloured circles at the top of the feed, where a social app shows
 * stories. One tap opens Explore on that area.
 */
export function AreaRail() {
  const lang = useLang();
  const colors = useColors();
  const fields = useFields();
  const palette = useAreaPalette();
  if (!fields.data?.length) return null;
  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {fields.data.map((field) => {
          const c = palette(field.slug);
          return (
            <Tap
              key={field.slug}
              onPress={() => router.navigate({ pathname: '/explore', params: { area: field.slug } })}
              accessibilityLabel={fieldName(field, lang)}
              style={styles.item}
            >
              <View style={[styles.ring, { borderColor: c.solid }]}>
                <View style={[styles.circle, { backgroundColor: c.solid }]}>
                  <AreaGlyph slug={field.slug} size={26} weight="fill" color={c.on} />
                </View>
              </View>
              <AppText variant="caption" weight="medium" numberOfLines={1} align="center" style={styles.label}>
                {shortFieldName(field, lang)}
              </AppText>
            </Tap>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: space.sm },
  row: { paddingHorizontal: layout.screenPadding - 8, paddingVertical: space.md, gap: space.xs },
  item: { width: 84, alignItems: 'center', gap: 6 },
  ring: { width: 68, height: 68, borderRadius: 34, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 57, height: 57, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  label: { maxWidth: 84 },
});
