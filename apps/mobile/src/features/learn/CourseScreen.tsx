import { ScrollView, StyleSheet, View } from 'react-native';
import { useCourse } from '@/api/learn';
import { useLang, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Divider, Tag } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { CheckCircle, Circle } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { fieldName } from '../fields';
import { KIND_ICON, KIND_LABEL } from './LearnHome';

/**
 * One of our courses: its lessons in order, with progress. "Start" or "Resume" opens the next
 * lesson; the bar at the bottom steps through them (Previous · 3 of 8 · Next) and records the step
 * reached, which also marks those lessons done for Learn first.
 */
export function CourseScreen({ id }: { id: string }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const course = useCourse(id);

  if (course.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader />
        <RowsSkeleton rows={4} />
      </View>
    );
  }
  if (course.isError || !course.data) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader />
        <ErrorState onRetry={() => void course.refetch()} />
      </View>
    );
  }

  const data = course.data;
  const reached = data.my_progress?.last_position ?? 0;
  const total = data.items.length;
  const resumeAt = Math.min(reached + 1, total);

  const open = (n: number) => {
    const item = data.items[n - 1];
    if (item) go.lesson(item.id, { id, step: n });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('learn.courses')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.intro}>
          {data.field ? <Tag label={fieldName(data.field, lang)} tone="accent" /> : null}
          <AppText variant="display">{data.title}</AppText>
          {data.description ? (
            <AppText variant="reading" tone="textSecondary">
              {data.description}
            </AppText>
          ) : null}
          <View style={[styles.track, { backgroundColor: colors.elevated }]}>
            <View style={[styles.fill, { width: `${total ? (reached / total) * 100 : 0}%`, backgroundColor: colors.accent }]} />
          </View>
          <AppText variant="label" tone={data.my_progress?.completed_at ? 'accent' : 'textSecondary'}>
            {data.my_progress?.completed_at ? t('learn.courseDone') : t('learn.progress', { done: reached, total })}
          </AppText>
        </View>
        <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {data.items.map((item, index) => {
            const Icon = KIND_ICON[item.kind]!;
            const done = item.step <= reached;
            return (
              <View key={item.id}>
                {index > 0 ? <Divider inset={layout.screenPadding + 40} /> : null}
                <Tap feedback="fill" onPress={() => open(item.step)} style={styles.item}>
                  {done ? <CheckCircle size={24} weight="fill" color={colors.accent} /> : <Circle size={24} color={colors.textTertiary} />}
                  <View style={styles.flex}>
                    <AppText variant="meta" tone="textTertiary">
                      {String(item.step).padStart(2, '0')}
                    </AppText>
                    <AppText variant="body" weight="medium">
                      {item.title}
                    </AppText>
                    <View style={styles.kind}>
                      <Icon size={14} color={colors.textTertiary} />
                      <AppText variant="caption" tone="textTertiary">
                        {t(KIND_LABEL[item.kind]!)}
                      </AppText>
                    </View>
                  </View>
                </Tap>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <Button label={reached > 0 ? t('learn.resume') : t('learn.start')} block onPress={() => open(resumeAt)} disabled={!total} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingBottom: space.x4 },
  intro: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, paddingBottom: space.xl, gap: space.sm },
  track: { height: 4, borderRadius: radius.xs, overflow: 'hidden', marginTop: space.sm },
  fill: { height: 4 },
  surface: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  kind: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  bar: { paddingHorizontal: layout.screenPadding, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
