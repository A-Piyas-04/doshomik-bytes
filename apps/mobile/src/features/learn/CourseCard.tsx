import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Course } from '@/api/types';
import { useLang, useT } from '@/i18n';
import { hostOf, openExternal } from '@/lib/share';
import { go } from '@/shell/nav';
import { useArea, useWash } from '@/theme/area';
import { useColors } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { ArrowUpRight, CheckCircle } from '@/ui/icons';
import { Tap } from '@/ui/Tap';
import { AreaGlyph, fieldName } from '../fields';

/**
 * A course in a carousel: a cover in the course's area colour (its glyph large, ours or free), then
 * the title and how far along you are. Outside courses open their link.
 */
export const CourseCard = memo(function CourseCard({ course, width = 220 }: { course: Course; width?: number }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const area = useArea(course.field?.slug);
  const wash = useWash();
  const external = !!course.external_url;
  const done = course.my_progress?.last_position ?? 0;
  const pct = course.item_count ? Math.min(1, done / course.item_count) : 0;

  return (
    <Tap
      onPress={() => (external ? void openExternal(course.external_url!) : go.course(course.id))}
      accessibilityLabel={course.title}
      accessibilityHint={external ? t('common.opensOutside') : undefined}
      style={[styles.card, { width, backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.cover, { backgroundColor: wash(area.solid) }]}>
        <AreaGlyph slug={course.field?.slug} size={104} weight="fill" color={area.solid} style={styles.bigGlyph} />
        <View style={[styles.kind, { backgroundColor: colors.surface }]}>
          <AppText variant="micro" tone="text">
            {external ? t('learn.freeCourse') : t('learn.ourCourse')}
          </AppText>
        </View>
        {course.field ? (
          <AppText variant="micro" tone="text" numberOfLines={1} style={styles.area}>
            {fieldName(course.field, lang)}
          </AppText>
        ) : null}
      </View>
      <View style={styles.body}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {course.title}
        </AppText>
        {external ? (
          <View style={styles.row}>
            <AppText variant="caption" tone="accent" numberOfLines={1}>
              {hostOf(course.external_url!)}
            </AppText>
            <ArrowUpRight size={12} weight="bold" color={colors.accent} />
          </View>
        ) : course.my_progress?.completed_at ? (
          <View style={styles.row}>
            <CheckCircle size={14} weight="fill" color={colors.accent} />
            <AppText variant="caption" tone="accent">
              {t('learn.completed')}
            </AppText>
          </View>
        ) : course.my_progress ? (
          <View style={styles.progress}>
            <View style={[styles.track, { backgroundColor: colors.elevated }]}>
              <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: area.solid }]} />
            </View>
            <AppText variant="caption" tone="textSecondary">
              {t('learn.progress', { done, total: course.item_count })}
            </AppText>
          </View>
        ) : (
          <AppText variant="caption" tone="textTertiary">
            {t('learn.lessonCount', { n: course.item_count })}
          </AppText>
        )}
      </View>
    </Tap>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  cover: { height: 112, padding: space.md, justifyContent: 'space-between', overflow: 'hidden' },
  bigGlyph: { position: 'absolute', right: -16, bottom: -24, opacity: 0.3 },
  kind: { alignSelf: 'flex-start', paddingHorizontal: 6, height: 20, borderRadius: radius.xs, justifyContent: 'center' },
  area: { maxWidth: '70%' },
  body: { padding: space.md, gap: space.xs, minHeight: 78 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  progress: { gap: 4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4 },
});
