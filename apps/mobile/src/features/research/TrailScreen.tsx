import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ApiError } from '@/api/client';
import { useDeleteTrail, useTrail, useTrailStatus } from '@/api/research';
import { useMe } from '@/api/social';
import { useLang, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { confirm, showActions } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Tag } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { DotsThree, Flag, Path, PencilSimple, Trash, ArrowDown } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { reportFlow } from '../social/menus';
import { fieldName } from '../fields';
import { pathProgress, Timeline } from './Timeline';

/** A trail: who made it and why, then its papers as a timeline with the author's notes. */
export function TrailScreen({ id }: { id: string }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const me = useMe();
  const trail = useTrail(id);
  const setStatus = useTrailStatus(id);
  const remove = useDeleteTrail();

  if (trail.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader />
        <RowsSkeleton rows={4} />
      </View>
    );
  }
  if (trail.isError || !trail.data) {
    const missing = trail.error instanceof ApiError && trail.error.status === 404;
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader />
        {missing ? <EmptyState icon={Path} message={t('post.unavailable')} /> : <ErrorState onRetry={() => void trail.refetch()} />}
      </View>
    );
  }

  const data = trail.data;
  const mine = data.creator.id === me.data?.id;
  const progress = pathProgress(data.steps);
  const name = data.creator.display_name ?? data.creator.username;

  const menu = () =>
    showActions({
      actions: mine
        ? [
            { label: t('common.edit'), icon: PencilSimple, onPress: () => go.editTrail(id) },
            data.status === 'published'
              ? { label: t('trails.unpublish'), icon: ArrowDown, onPress: () => setStatus.mutate('draft') }
              : { label: t('common.publish'), icon: Path, onPress: () => setStatus.mutate('published') },
            {
              label: t('trails.delete'),
              icon: Trash,
              destructive: true,
              onPress: async () => {
                const ok = await confirm({ title: t('trails.deleteConfirm'), confirmLabel: t('common.delete'), destructive: true });
                if (ok) remove.mutate(id, { onSuccess: () => router.back() });
              },
            },
          ]
        : [{ label: t('common.report'), icon: Flag, destructive: true, onPress: () => reportFlow('trail', id) }],
    });

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('trails.title')} right={<IconButton icon={DotsThree} weight="bold" label={t('trails.options')} onPress={menu} />} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {data.status !== 'published' ? (
          <View style={[styles.banner, { backgroundColor: data.status === 'removed' ? colors.highlightWash : colors.elevated }]}>
            <AppText variant="label" tone={data.status === 'removed' ? 'danger' : 'textSecondary'} style={styles.flex}>
              {data.status === 'removed' ? t('trails.removedBanner') : t('trails.draftBanner')}
            </AppText>
            {mine && data.status === 'draft' ? (
              <Button label={t('common.publish')} size="sm" disabled={data.steps.length < 2} onPress={() => setStatus.mutate('published')} loading={setStatus.isPending} />
            ) : null}
          </View>
        ) : null}
        <View style={styles.intro}>
          <View style={styles.tags}>
            {data.field ? <Tag label={fieldName(data.field, lang)} tone="accent" /> : null}
            <Tag label={data.lang === 'bn' ? t('trails.inBangla') : t('trails.inEnglish')} />
          </View>
          <AppText variant="display" style={styles.title}>
            {data.title}
          </AppText>
          {data.description ? (
            <AppText variant="reading" tone="textSecondary">
              {data.description}
            </AppText>
          ) : null}
          <Tap onPress={() => go.user(data.creator.id)} style={styles.creator} accessibilityLabel={t('a11y.openProfile', { name })}>
            <Avatar url={data.creator.avatar_url} name={name} size={32} />
            <AppText variant="label" tone="textSecondary">
              {t('trails.by', { name: data.creator.username })}
            </AppText>
          </Tap>
          {data.steps.length ? (
            <AppText variant="label" tone="accent">
              {t('roadmap.progress', { read: progress.read, total: progress.total })}
            </AppText>
          ) : null}
        </View>
        <Timeline steps={data.steps} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingBottom: space.x5 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: layout.screenPadding, marginTop: space.md, padding: space.md, borderRadius: radius.sm },
  intro: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, paddingBottom: space.lg, gap: space.sm },
  tags: { flexDirection: 'row', gap: space.sm },
  title: { marginTop: space.xs },
  creator: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', paddingVertical: space.xs },
});
