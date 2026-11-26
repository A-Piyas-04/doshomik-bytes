import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useFields, useInterests, usePapers, useReadingStats, useToggleSave, useUpNext } from '@/api/research';
import type { PaperCard } from '@/api/types';
import { useLang, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { showActions } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { Divider, ListFooter, NavRow, SectionLabel } from '@/ui/Bits';
import { IconButton } from '@/ui/IconButton';
import { ArrowsDownUp, Books, CaretRight, FileText, MagnifyingGlass, MapTrifold, Path } from '@/ui/icons';
import { Bone, Pulse, RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { ALL, FieldChips, FOR_YOU, fieldName, InterestsSheet } from '../fields';
import { paperMeta } from './paper-text';
import { PaperRow } from './PaperRow';

export interface ScrollableHandle {
  scrollToTop: () => void;
}

/**
 * Home › Research. Three zones, top to bottom, so the first view never offers more than a handful
 * of choices:
 *   1. Your desk: exactly one row that depends on where the user is (up next, this month,
 *      pick your fields, or start a roadmap), plus the way into the Library.
 *   2. Reading paths: Roadmaps (staff, by field) and Trails (made by people).
 *   3. Papers: one row of area chips, a quiet sort switch and search, then the list.
 */
export const ResearchHome = forwardRef<ScrollableHandle, { active: boolean }>(function ResearchHome({ active }, ref) {
  const t = useT();
  const colors = useColors();
  const interests = useInterests();
  const hasInterests = (interests.data?.length ?? 0) > 0;
  const [chip, setChip] = useState<string>(ALL);
  const [sort, setSort] = useState<'trend' | 'newest'>('trend');
  const filter = useMemo(
    () => ({ sort, field: chip !== ALL && chip !== FOR_YOU ? chip : undefined, interests: chip === FOR_YOU ? true : undefined }),
    [chip, sort],
  );
  const papers = usePapers(filter, active || chip === ALL);
  const toggleSave = useToggleSave();
  const listRef = useRef<FlashListRef<PaperCard>>(null);

  useImperativeHandle(ref, () => ({ scrollToTop: () => listRef.current?.scrollToOffset({ offset: 0, animated: true }) }), []);

  const onToggleSave = useCallback((id: string, save: boolean) => toggleSave.mutate({ id, save }), [toggleSave]);
  const renderItem = useCallback(
    ({ item }: { item: PaperCard }) => <PaperRow paper={item} onOpen={go.paper} onToggleSave={onToggleSave} />,
    [onToggleSave],
  );

  const chooseSort = () =>
    showActions({
      title: t('research.papers'),
      actions: [
        { label: t('research.sortTrending'), onPress: () => setSort('trend') },
        { label: t('research.sortNewest'), onPress: () => setSort('newest') },
      ],
    });

  const header = (
    <View>
      <Desk />
      <SectionLabel label={t('research.paths')} />
      <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <NavRow icon={MapTrifold} title={t('research.roadmaps')} subtitle={t('research.roadmapsHint')} onPress={() => go.roadmaps()} />
        <Divider inset={layout.screenPadding + 52} />
        <NavRow icon={Path} title={t('research.trails')} subtitle={t('research.trailsHint')} onPress={go.trails} />
      </View>

      <View style={styles.papersHeader}>
        <AppText variant="meta" tone="textTertiary" accessibilityRole="header" style={styles.flex}>
          {t('research.papers')}
        </AppText>
        <Tap onPress={chooseSort} style={styles.sort} accessibilityLabel={t('research.sortLabel', { order: t(sort === 'trend' ? 'research.sortTrending' : 'research.sortNewest') })}>
          <ArrowsDownUp size={16} color={colors.textSecondary} />
          <AppText variant="label" tone="textSecondary">
            {t(sort === 'trend' ? 'research.sortTrending' : 'research.sortNewest')}
          </AppText>
        </Tap>
        <IconButton icon={MagnifyingGlass} size={22} label={t('research.searchPapers')} onPress={go.paperSearch} />
      </View>
      <FieldChips value={chip} onChange={setChip} forYou={hasInterests} style={styles.chips} />
      <View style={[styles.listTop, { backgroundColor: colors.border }]} />
    </View>
  );

  let empty: React.ReactElement | null = null;
  if (papers.isPending) empty = <RowsSkeleton rows={4} />;
  else if (papers.isError) empty = <ErrorState onRetry={() => void papers.refetch()} />;
  else empty = <EmptyState icon={FileText} message={t('research.noPapers')} />;

  return (
    <FlashList
      ref={listRef}
      data={papers.items}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ItemSeparatorComponent={RowDivider}
      onEndReached={papers.loadMore}
      onEndReachedThreshold={1}
      ListFooterComponent={<ListFooter loading={papers.isFetchingNextPage} done={!papers.hasNextPage && papers.items.length > 6} doneLabel={t('common.endOfList')} />}
      refreshControl={<RefreshControl refreshing={papers.isRefetching && !papers.isFetchingNextPage} onRefresh={() => void papers.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
      keyboardShouldPersistTaps="handled"
    />
  );
});

function RowDivider() {
  const colors = useColors();
  return (
    <View style={{ backgroundColor: colors.surface }}>
      <Divider />
    </View>
  );
}

/** Zone 1: one row that meets the user where they are. */
function Desk() {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const upNext = useUpNext();
  const stats = useReadingStats();
  const interests = useInterests();
  const fields = useFields();
  const [picking, setPicking] = useState(false);

  let row: React.ReactElement;
  if (upNext.isPending || stats.isPending || interests.isPending) {
    row = (
      <Pulse style={styles.deskSkeleton}>
        <Bone width="40%" height={10} />
        <Bone width="85%" height={18} />
      </Pulse>
    );
  } else if (upNext.data) {
    const paper = upNext.data;
    // The one ink block on the page: where to pick up again.
    row = (
      <Tap onPress={() => go.paper(paper.id)} style={[styles.banner, { backgroundColor: colors.banner }]} accessibilityHint={t('research.upNext')}>
        <View style={styles.flex}>
          <AppText variant="meta" style={{ color: colors.highlight }}>
            {t('research.upNext')}
          </AppText>
          <AppText variant="paperRow" tone="onBanner" numberOfLines={2}>
            {paper.title}
          </AppText>
          <AppText variant="caption" tone="onBanner" numberOfLines={1} style={styles.dim}>
            {paperMeta(paper, lang)}
          </AppText>
        </View>
        <CaretRight size={16} color={colors.onBanner} />
      </Tap>
    );
  } else if ((stats.data?.total.explored ?? 0) > 0) {
    row = (
      <NavRow
        icon={Books}
        title={t('research.monthStats', { explored: stats.data!.this_month.explored, studied: stats.data!.this_month.studied })}
        subtitle={t('research.monthStatsHint')}
        onPress={go.library}
      />
    );
  } else if (!interests.data?.length) {
    row = <NavRow icon={MapTrifold} title={t('research.pickFields')} subtitle={t('research.pickFieldsHint')} onPress={() => setPicking(true)} />;
  } else {
    const first = interests.data[0]!;
    const field = fields.data?.find((f) => f.slug === first.slug) ?? first;
    row = (
      <NavRow
        icon={MapTrifold}
        title={t('research.startRoadmap', { field: fieldName(field, lang) })}
        subtitle={t('research.startRoadmapHint')}
        onPress={() => go.roadmaps(first.slug)}
      />
    );
  }

  const onSurface = !upNext.data;
  return (
    <View>
      <SectionLabel label={t('research.library')} action={t('common.seeAll')} onAction={go.library} style={styles.deskLabel} />
      {onSurface ? <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>{row}</View> : row}
      <InterestsSheet visible={picking} onClose={() => setPicking(false)} onSaved={(picked) => picked[0] && go.roadmaps(picked[0])} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  deskLabel: { paddingTop: space.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: layout.screenPadding, padding: space.lg, borderRadius: radius.md },
  dim: { opacity: 0.7 },
  surface: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  listTop: { height: StyleSheet.hairlineWidth },
  deskSkeleton: { paddingHorizontal: layout.screenPadding, paddingVertical: space.md, gap: space.sm },
  papersHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: layout.screenPadding, paddingRight: space.xs, paddingTop: space.xxl },
  sort: { flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 44, paddingHorizontal: space.sm },
  chips: { flexGrow: 0, paddingBottom: space.sm },
});
