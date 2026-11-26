import { useScrollToTop } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCourses, useLearnItems, useMyCourses } from '@/api/learn';
import type { Course, LearnItem } from '@/api/types';
import { useT, type MessageKey } from '@/i18n';
import { go } from '@/shell/nav';
import { useArea, useWash } from '@/theme/area';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Divider, SectionTitle } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { ArrowRight, Article, BookOpen, CaretRight, Exam, Globe, GraduationCap, ImageGlyph, PlayCircle, type IconComponent } from '@/ui/icons';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { ALL, FieldChips } from '../fields';
import { CourseCard } from './CourseCard';

export const KIND_ICON: Record<string, IconComponent> = { video: PlayCircle, image: ImageGlyph, text: Article };
export const KIND_LABEL: Record<string, MessageKey> = { video: 'learn.video', image: 'learn.figure', text: 'learn.note' };

/**
 * Learn: pick an area, pick up where you left off, practise, then browse courses (ours and free
 * outside ones) as carousels and short lessons grouped by concept.
 */
export function LearnHome() {
  const t = useT();
  const colors = useColors();
  const wash = useWash();
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState(ALL);
  const field = area === ALL ? undefined : area;
  const mine = useMyCourses();
  const courses = useCourses(field);
  const items = useLearnItems({ field });
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useScrollToTop(scroll as never);

  const groups = useMemo(() => {
    const byTopic = new Map<string, { slug: string | null; name: string; field: string | null; items: LearnItem[] }>();
    for (const item of items.items) {
      const key = item.topic?.slug ?? '';
      const group = byTopic.get(key) ?? { slug: item.topic?.slug ?? null, name: item.topic?.name ?? '', field: item.topic?.field ?? null, items: [] };
      group.items.push(item);
      byTopic.set(key, group);
    }
    return [...byTopic.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items.items]);

  const ours = courses.items.filter((course) => !course.external_url);
  const free = courses.items.filter((course) => !!course.external_url);
  const inProgress = mine.items.filter((course) => !course.my_progress?.completed_at).slice(0, 1);

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
            refreshing={courses.isRefetching || items.isRefetching}
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

        {inProgress[0] ? <ContinueCard course={inProgress[0]} /> : null}

        <Tap onPress={go.practice} style={[styles.practice, { backgroundColor: wash(colors.highlight) }]} accessibilityLabel={t('learn.practice')}>
          <View style={[styles.practiceIcon, { backgroundColor: colors.highlight }]}>
            <Exam size={22} weight="fill" color={colors.inverse} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('practice.start')}</AppText>
            <AppText variant="caption" tone="textSecondary">
              {t('learn.practiceHint')}
            </AppText>
          </View>
          <ArrowRight size={20} weight="bold" color={colors.text} />
        </Tap>

        {courses.isPending ? <RowsSkeleton rows={2} /> : null}
        {courses.isError ? <ErrorState onRetry={() => void courses.refetch()} /> : null}
        {ours.length ? <Carousel icon={GraduationCap} color={colors.accent} label={t('learn.ourCourses')} courses={ours} /> : null}
        {free.length ? <Carousel icon={Globe} color={colors.highlight} label={t('learn.freeCourses')} courses={free} /> : null}
        {!courses.isPending && !courses.isError && courses.items.length === 0 ? <EmptyState icon={GraduationCap} message={t('learn.empty')} /> : null}

        <SectionTitle icon={BookOpen} color={colors.text} title={t('learn.lessons')} />
        {items.isPending ? <RowsSkeleton rows={3} /> : null}
        {!items.isPending && groups.length === 0 ? <EmptyState icon={Article} message={t('learn.empty')} /> : null}
        {groups.map((group) => (
          <View key={group.slug ?? 'none'} style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {group.slug ? (
              <Tap onPress={() => go.topic(group.slug!)} style={styles.groupHead} accessibilityHint={t('learn.topic')}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  {group.name}
                </AppText>
                <CaretRight size={14} color={colors.textTertiary} />
              </Tap>
            ) : null}
            {group.items.map((item) => (
              <View key={item.id}>
                <Divider inset={layout.screenPadding} />
                <LessonRow item={item} />
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Carousel({ icon, color, label, courses }: { icon: IconComponent; color: string; label: string; courses: Course[] }) {
  return (
    <View>
      <SectionTitle icon={icon} color={color} title={label} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
        {courses.map((course) => (
          <CourseCard key={course.id} course={course} />
        ))}
      </ScrollView>
    </View>
  );
}

/** A lesson row: a glyph on its area's wash, the title, the kind and length. */
export function LessonRow({ item }: { item: Pick<LearnItem, 'id' | 'title' | 'kind' | 'duration_seconds'> & { topic?: LearnItem['topic'] } }) {
  const t = useT();
  const area = useArea(item.topic?.field);
  const Icon = KIND_ICON[item.kind] ?? Article;
  const minutes = item.duration_seconds ? t('common.minutes', { n: Math.max(1, Math.round(item.duration_seconds / 60)) }) : null;
  return (
    <Tap feedback="fill" onPress={() => go.lesson(item.id)} style={styles.lesson}>
      <View style={[styles.lessonIcon, { backgroundColor: area.tint }]}>
        <Icon size={20} color={area.ink} weight="fill" />
      </View>
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

function ContinueCard({ course }: { course: Course }) {
  const t = useT();
  const colors = useColors();
  const area = useArea(course.field?.slug);
  const done = course.my_progress?.last_position ?? 0;
  const pct = course.item_count ? done / course.item_count : 0;
  return (
    <Tap onPress={() => go.course(course.id)} style={[styles.continue, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.continueBar, { backgroundColor: area.tint }]}>
        <AppText variant="meta" style={{ color: area.ink }}>
          {t('learn.continue')}
        </AppText>
      </View>
      <View style={styles.continueBody}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {course.title}
        </AppText>
        <View style={[styles.track, { backgroundColor: colors.elevated }]}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: area.solid }]} />
        </View>
        <View style={styles.continueFoot}>
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            {t('learn.progress', { done, total: course.item_count })}
          </AppText>
          <AppText variant="label" weight="semibold" style={{ color: area.ink }}>
            {t('learn.resume')}
          </AppText>
        </View>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, height: 58 },
  scroll: { paddingBottom: space.x5 },
  chips: { flexGrow: 0, paddingBottom: space.sm },
  practice: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.md, marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  practiceIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  carousel: { paddingHorizontal: space.md, gap: space.md },
  group: { marginHorizontal: space.md, marginBottom: space.md, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  lessonIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  continue: { marginHorizontal: space.md, marginTop: space.sm, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  continueBar: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  continueBody: { padding: space.lg, gap: space.sm },
  continueFoot: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5 },
});
