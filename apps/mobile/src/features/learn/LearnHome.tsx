import { useScrollToTop } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCourses, useLearnItems, useMyCourses } from '@/api/learn';
import type { Course, LearnItem } from '@/api/types';
import { useT, type MessageKey } from '@/i18n';
import { hostOf, openExternal } from '@/lib/share';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Divider, SectionLabel, Tag } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { ArrowUpRight, Article, CaretRight, Exam, GraduationCap, ImageGlyph, PlayCircle, type IconComponent } from '@/ui/icons';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { ALL, FieldChips } from '../fields';

export const KIND_ICON: Record<string, IconComponent> = { video: PlayCircle, image: ImageGlyph, text: Article };
export const KIND_LABEL: Record<string, MessageKey> = { video: 'learn.video', image: 'learn.figure', text: 'learn.note' };

/**
 * Learn: pick an area, pick up where you left off, then courses (ours and free outside ones) and
 * short lessons grouped by concept. Practice is one button away in the header.
 */
export function LearnHome() {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState(ALL);
  const field = area === ALL ? undefined : area;
  const mine = useMyCourses();
  const courses = useCourses(field);
  const items = useLearnItems({ field });
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useScrollToTop(scroll as never);

  const groups = useMemo(() => {
    const byTopic = new Map<string, { slug: string | null; name: string; items: LearnItem[] }>();
    for (const item of items.items) {
      const key = item.topic?.slug ?? '';
      const group = byTopic.get(key) ?? { slug: item.topic?.slug ?? null, name: item.topic?.name ?? '', items: [] };
      group.items.push(item);
      byTopic.set(key, group);
    }
    return [...byTopic.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items.items]);

  const inProgress = mine.items.filter((course) => !course.my_progress?.completed_at).slice(0, 2);
  const refreshing = courses.isRefetching || items.isRefetching;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <AppText variant="display" accessibilityRole="header">
          {t('learn.title')}
        </AppText>
        <Button label={t('learn.practice')} icon={Exam} kind="secondary" size="sm" onPress={go.practice} />
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void courses.refetch();
              void items.refetch();
              void mine.refetch();
            }}
            tintColor={colors.accent}
          />
        }
      >
        <FieldChips value={area} onChange={setArea} style={styles.chips} />

        {inProgress.length ? (
          <>
            <SectionLabel label={t('learn.continue')} />
            <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {inProgress.map((course, index) => (
                <View key={course.id}>
                  {index > 0 ? <Divider /> : null}
                  <ContinueRow course={course} />
                </View>
              ))}
            </View>
          </>
        ) : null}

        <SectionLabel label={t('learn.courses')} />
        {courses.isPending ? <RowsSkeleton rows={2} /> : null}
        {courses.isError ? <ErrorState onRetry={() => void courses.refetch()} /> : null}
        {!courses.isPending && !courses.isError && courses.items.length === 0 ? <EmptyState icon={GraduationCap} message={t('learn.empty')} /> : null}
        {courses.items.length ? (
          <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {courses.items.map((course, index) => (
              <View key={course.id}>
                {index > 0 ? <Divider /> : null}
                <CourseRow course={course} />
              </View>
            ))}
          </View>
        ) : null}

        <SectionLabel label={t('learn.lessons')} />
        {items.isPending ? <RowsSkeleton rows={3} /> : null}
        {!items.isPending && groups.length === 0 ? <EmptyState icon={Article} message={t('learn.empty')} /> : null}
        {groups.map((group) => (
          <View key={group.slug ?? 'none'} style={styles.group}>
            {group.slug ? (
              <Tap onPress={() => go.topic(group.slug!)} style={styles.groupHead} accessibilityHint={t('learn.topic')}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  {group.name}
                </AppText>
                <CaretRight size={14} color={colors.textTertiary} />
              </Tap>
            ) : null}
            <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {group.items.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider inset={layout.screenPadding + 36} /> : null}
                  <LessonRow item={item} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function LessonRow({ item }: { item: Pick<LearnItem, 'id' | 'title' | 'kind' | 'duration_seconds'> }) {
  const t = useT();
  const colors = useColors();
  const Icon = KIND_ICON[item.kind] ?? Article;
  const minutes = item.duration_seconds ? t('common.minutes', { n: Math.max(1, Math.round(item.duration_seconds / 60)) }) : null;
  return (
    <Tap feedback="fill" onPress={() => go.lesson(item.id)} style={styles.lesson}>
      <Icon size={22} color={colors.accent} weight={item.kind === 'video' ? 'fill' : 'regular'} />
      <View style={styles.flex}>
        <AppText variant="body" weight="medium" numberOfLines={2}>
          {item.title}
        </AppText>
        <AppText variant="caption" tone="textTertiary">
          {[t(KIND_LABEL[item.kind] ?? 'learn.lesson'), minutes].filter(Boolean).join(' · ')}
        </AppText>
      </View>
    </Tap>
  );
}

function CourseRow({ course }: { course: Course }) {
  const t = useT();
  const colors = useColors();
  const external = !!course.external_url;
  const done = course.my_progress?.last_position ?? 0;
  return (
    <Tap
      feedback="fill"
      onPress={() => (external ? void openExternal(course.external_url!) : go.course(course.id))}
      accessibilityHint={external ? t('common.opensOutside') : undefined}
      style={styles.course}
    >
      <View style={styles.courseTags}>
        <Tag label={external ? t('learn.freeCourse') : t('learn.ourCourse')} tone={external ? 'neutral' : 'accent'} />
        {course.my_progress?.completed_at ? <Tag label={t('learn.completed')} tone="accent" /> : null}
      </View>
      <AppText variant="paperRow" numberOfLines={2}>
        {course.title}
      </AppText>
      {course.description ? (
        <AppText variant="body" tone="textSecondary" numberOfLines={2}>
          {course.description}
        </AppText>
      ) : null}
      <View style={styles.courseFoot}>
        {external ? (
          <>
            <AppText variant="caption" tone="accent">
              {hostOf(course.external_url!)}
            </AppText>
            <ArrowUpRight size={12} color={colors.accent} weight="bold" />
          </>
        ) : (
          <AppText variant="caption" tone="textTertiary">
            {course.my_progress ? t('learn.progress', { done, total: course.item_count }) : t('learn.lessonCount', { n: course.item_count })}
          </AppText>
        )}
      </View>
    </Tap>
  );
}

function ContinueRow({ course }: { course: Course }) {
  const t = useT();
  const colors = useColors();
  const done = course.my_progress?.last_position ?? 0;
  const pct = course.item_count ? done / course.item_count : 0;
  return (
    <Tap feedback="fill" onPress={() => go.course(course.id)} style={styles.continue}>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {course.title}
        </AppText>
        <View style={[styles.track, { backgroundColor: colors.elevated }]}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: colors.accent }]} />
        </View>
        <AppText variant="caption" tone="textSecondary">
          {t('learn.progress', { done, total: course.item_count })}
        </AppText>
      </View>
      <AppText variant="label" tone="accent">
        {t('learn.resume')}
      </AppText>
    </Tap>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, height: 60 },
  scroll: { paddingBottom: space.x5 },
  chips: { flexGrow: 0 },
  surface: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  group: { marginBottom: space.md },
  groupHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingVertical: space.sm, minHeight: 40 },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  course: { paddingHorizontal: layout.screenPadding, paddingVertical: space.lg, gap: space.xs + 2 },
  courseTags: { flexDirection: 'row', gap: space.sm },
  courseFoot: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  continue: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  track: { height: 4, borderRadius: radius.xs, marginVertical: space.sm, overflow: 'hidden' },
  fill: { height: 4 },
});
