import { FlashList } from '@shopify/flash-list';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMyPapers, useReadingStats, useToggleSave, useUserTrails } from '@/api/research';
import { useMe } from '@/api/social';
import type { PaperCard, Trail } from '@/api/types';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { ListFooter } from '@/ui/Bits';
import { BookmarkSimple, CheckCircle, Path } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SegmentedTabs } from '@/ui/SegmentedTabs';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState } from '@/ui/States';
import { PaperRow } from './PaperRow';
import { STEP_LABEL } from './ReadingDots';
import { CardGap } from './ResearchHome';
import { SurfaceDivider, TrailRow } from './TrailsScreen';

type Tab = 'saved' | 'read' | 'trails';

/** My research: what I read this month and in total, then Saved · Read · My trails. */
export function LibraryScreen() {
  const t = useT();
  const colors = useColors();
  const [tab, setTab] = useState<Tab>('saved');
  const stats = useReadingStats();
  const me = useMe();
  const saved = useMyPapers('saved');
  const read = useMyPapers('read');
  const trails = useUserTrails(tab === 'trails' ? me.data?.id : undefined);
  const toggleSave = useToggleSave();
  const onSave = useCallback((id: string, save: boolean) => toggleSave.mutate({ id, save }), [toggleSave]);
  const renderPaper = useCallback(({ item }: { item: PaperCard }) => <PaperRow paper={item} onOpen={go.paper} onToggleSave={onSave} />, [onSave]);
  const renderTrail = useCallback(({ item }: { item: Trail }) => <TrailRow trail={item} showStatus />, []);

  const options = useMemo(
    () => [
      { value: 'saved' as const, label: t('lib.saved') },
      { value: 'read' as const, label: t('lib.read') },
      { value: 'trails' as const, label: t('lib.myTrails') },
    ],
    [t],
  );

  const header = (
    <View>
      <View style={[styles.stats, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <StatColumn title={t('lib.thisMonth')} counts={stats.data?.this_month} />
        <View style={[styles.statRule, { backgroundColor: colors.border }]} />
        <StatColumn title={t('lib.allTime')} counts={stats.data?.total} />
      </View>
      <SegmentedTabs options={options} value={tab} onChange={setTab} style={styles.tabs} />
    </View>
  );

  const list = tab === 'saved' ? saved : read;
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('lib.title')} />
      {tab === 'trails' ? (
        <FlashList
          data={trails.items}
          renderItem={renderTrail}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          ItemSeparatorComponent={SurfaceDivider}
          ListEmptyComponent={trails.isPending ? <RowsSkeleton rows={2} /> : <EmptyState icon={Path} message={t('lib.trailsEmpty')} actionLabel={t('trails.new')} onAction={() => go.newTrail()} />}
          onEndReached={trails.loadMore}
          ListFooterComponent={<ListFooter loading={trails.isFetchingNextPage} />}
        />
      ) : (
        <FlashList
          data={list.items}
          renderItem={renderPaper}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          ItemSeparatorComponent={CardGap}
          ListEmptyComponent={
            list.isPending ? (
              <RowsSkeleton rows={3} />
            ) : tab === 'saved' ? (
              <EmptyState icon={BookmarkSimple} message={t('lib.savedEmpty')} actionLabel={t('research.papers')} onAction={() => go.paperSearch()} />
            ) : (
              <EmptyState icon={CheckCircle} message={t('lib.readEmpty')} />
            )
          }
          onEndReached={list.loadMore}
          ListFooterComponent={<ListFooter loading={list.isFetchingNextPage} />}
        />
      )}
    </View>
  );
}

function StatColumn({ title, counts }: { title: string; counts?: { explored: number; studied: number; reproduced: number } }) {
  const t = useT();
  return (
    <View style={styles.statColumn}>
      <AppText variant="meta" tone="textTertiary">
        {title}
      </AppText>
      {([1, 2, 3] as const).map((step) => {
        const value = counts ? [counts.explored, counts.studied, counts.reproduced][step - 1] : null;
        return (
          <View key={step} style={styles.statRow}>
            <AppText variant="title" style={styles.statNumber}>
              {value ?? '–'}
            </AppText>
            <AppText variant="caption" tone="textSecondary">
              {t(STEP_LABEL[step])}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stats: { flexDirection: 'row', marginTop: space.md, paddingVertical: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  statColumn: { flex: 1, paddingHorizontal: layout.screenPadding, gap: space.xs },
  statRule: { width: StyleSheet.hairlineWidth },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  statNumber: { minWidth: 28, fontVariant: ['tabular-nums'] },
  tabs: { marginTop: space.md, marginBottom: space.md },
});
