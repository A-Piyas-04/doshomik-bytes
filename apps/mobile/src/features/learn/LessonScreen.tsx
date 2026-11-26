import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ApiError } from '@/api/client';
import { useCompleteLearnItem, useCourse, useLearnItem, useSaveProgress } from '@/api/learn';
import type { LearnItem } from '@/api/types';
import { useT, type MessageKey } from '@/i18n';
import { hostOf, openExternal } from '@/lib/share';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Tag } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { ArrowUpRight, Article, Check, PlayCircle , CaretLeft, CaretRight } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Bone, Pulse } from '@/ui/Skeleton';
import { router } from 'expo-router';

import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';

const KIND_LABEL: Record<string, MessageKey> = { video: 'learn.video', image: 'learn.figure', text: 'learn.note' };

/** True when the URL is a file a player can stream (our HLS, or an mp4 link). */
const playable = (url: string) => /\.(m3u8|mp4|webm|mov)(\?|$)/i.test(url);

/**
 * One learn item: a video plays inline, a figure opens full screen to zoom, a note reads as a
 * short article. Outside videos (YouTube and similar) open in the browser. "Mark as done" counts
 * towards every paper's Learn first.
 */
export function LessonScreen({ id, courseId, step }: { id: string; courseId?: string; step?: number }) {
  const t = useT();
  const colors = useColors();
  const item = useLearnItem(id);
  const complete = useCompleteLearnItem();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const course = useCourse(courseId ?? '', !!courseId);
  const progress = useSaveProgress(courseId ?? '');

  if (item.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        <ScreenHeader surface />
        <Pulse style={styles.skeleton}>
          <Bone width="30%" height={10} />
          <Bone width="80%" height={24} />
          <Bone width="100%" height={200} />
        </Pulse>
      </View>
    );
  }
  if (item.isError || !item.data) {
    const missing = item.error instanceof ApiError && item.error.status === 404;
    return (
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        <ScreenHeader surface />
        {missing ? <EmptyState icon={Article} message={t('post.unavailable')} /> : <ErrorState onRetry={() => void item.refetch()} />}
      </View>
    );
  }
  const data = item.data;
  const toggle = (value: boolean) =>
    complete.mutate(
      { id, done: value },
      {
        onSuccess: () => {
          setDone(value);
          void queryClient.invalidateQueries({ queryKey: ['learn-item', id] });
        },
      },
    );

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <ScreenHeader surface title={t(KIND_LABEL[data.kind] ?? 'learn.lesson')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          {data.topic ? (
            <Tap onPress={() => go.topic(data.topic!.slug)} style={styles.topic}>
              <Tag label={data.topic.name} tone="accent" />
            </Tap>
          ) : null}
          <AppText variant="display" accessibilityRole="header">
            {data.title}
          </AppText>
          {data.duration_seconds ? (
            <AppText variant="caption" tone="textTertiary">
              {t('common.minutes', { n: Math.max(1, Math.round(data.duration_seconds / 60)) })}
            </AppText>
          ) : null}
        </View>
        <Media item={data} />
        {data.body ? (
          <View style={styles.body}>
            <AppText variant="reading">{data.body}</AppText>
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.bar, { borderTopColor: colors.border }]}>
        {courseId && step && course.data ? (
          <CourseStepper
            step={step}
            total={course.data.items.length}
            saving={progress.isPending}
            onPrevious={() => {
              const prev = course.data!.items[step - 2];
              if (prev) go.courseStep(prev.id, { id: courseId, step: step - 1 });
            }}
            onNext={() => {
              const next = course.data!.items[step];
              const reached = course.data!.my_progress?.last_position ?? 0;
              const save = (after: () => void) => (step > reached ? progress.mutate(step, { onSuccess: after }) : after());
              if (next) save(() => go.courseStep(next.id, { id: courseId, step: step + 1 }));
              else save(() => router.back());
            }}
          />
        ) : done ? (
          <Button label={t('learn.done')} icon={Check} kind="secondary" block onPress={() => toggle(false)} accessibilityHint={t('learn.undoDone')} />
        ) : (
          <Button label={t('learn.markDone')} block loading={complete.isPending} onPress={() => toggle(true)} />
        )}
      </View>
    </View>
  );
}

/** Inside a course: Previous · 3 of 8 · Next. Next records the step reached. */
function CourseStepper({ step, total, saving, onPrevious, onNext }: { step: number; total: number; saving: boolean; onPrevious: () => void; onNext: () => void }) {
  const t = useT();
  return (
    <View style={styles.stepper}>
      <Button label={t('common.previous')} icon={CaretLeft} kind="secondary" size="sm" disabled={step <= 1} onPress={onPrevious} />
      <AppText variant="label" tone="textSecondary" style={styles.stepText}>
        {t('learn.stepOf', { n: step, total })}
      </AppText>
      <Button label={step >= total ? t('learn.finish') : t('common.next')} trailingIcon={step >= total ? undefined : CaretRight} size="sm" loading={saving} onPress={onNext} />
    </View>
  );
}

function Media({ item }: { item: LearnItem }) {
  const t = useT();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const mediaWidth = Math.min(width, 720);
  const source = item.media?.url ?? item.media_url;
  if (!source) return null;

  if (item.kind === 'image') {
    return (
      <Tap onPress={() => go.image(item.media?.full_url ?? source)} accessibilityLabel={item.title}>
        <Image source={{ uri: source }} style={{ width: mediaWidth, height: mediaWidth * 0.66, backgroundColor: colors.bg }} contentFit="contain" />
      </Tap>
    );
  }
  if (item.kind === 'video' && playable(source)) return <InlineVideo uri={source} width={mediaWidth} poster={item.media?.thumbnail_url ?? null} />;
  // An outside video page (YouTube, Coursera…): open it where it lives.
  return (
    <View style={[styles.external, { borderColor: colors.border, backgroundColor: colors.bg }]}>
      <PlayCircle size={40} weight="fill" color={colors.accent} />
      <AppText variant="body" tone="textSecondary" align="center">
        {hostOf(source)}
      </AppText>
      <Button label={t('learn.watchOn', { site: hostOf(source) })} trailingIcon={ArrowUpRight} onPress={() => void openExternal(source)} />
    </View>
  );
}

function InlineVideo({ uri, width }: { uri: string; width: number; poster: string | null }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <View style={{ width, height: (width * 9) / 16, backgroundColor: '#000' }}>
      <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: space.x4 },
  skeleton: { padding: layout.screenPadding, gap: space.md },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, paddingBottom: space.lg, gap: space.sm },
  topic: { alignSelf: 'flex-start' },
  body: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, maxWidth: layout.maxTextWidth + layout.screenPadding * 2 },
  external: { marginHorizontal: layout.screenPadding, borderWidth: 1, borderRadius: radius.md, padding: space.xxl, alignItems: 'center', gap: space.md },
  bar: { paddingHorizontal: layout.screenPadding, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepText: { flex: 1, textAlign: 'center' },
});
