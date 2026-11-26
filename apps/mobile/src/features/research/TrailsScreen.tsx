import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useTrails } from '@/api/research';
import type { Trail } from '@/api/types';
import { useLang, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Divider, ListFooter, Tag } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Path, Plus } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { ALL, FieldChips, fieldName } from '../fields';

/** A trail in a list: title, one line of description, who made it, how many papers. */
export const TrailRow = memo(function TrailRow({ trail, showStatus }: { trail: Trail; showStatus?: boolean }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const meta = [t('trails.by', { name: trail.creator.username }), t('trails.papers', { n: trail.paper_count }), trail.field ? fieldName(trail.field, lang) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Tap feedback="fill" onPress={() => go.trail(trail.id)} style={[styles.row, { backgroundColor: colors.surface }]}>
      {trail.lang === 'bn' || (showStatus && trail.status !== 'published') ? (
        <View style={styles.tags}>
          {trail.lang === 'bn' ? <Tag label={t('trails.inBangla')} /> : null}
          {showStatus && trail.status !== 'published' ? (
            <Tag label={t(trail.status === 'draft' ? 'lib.statusDraft' : 'lib.statusRemoved')} tone={trail.status === 'removed' ? 'danger' : 'neutral'} />
          ) : null}
        </View>
      ) : null}
      <AppText variant="paperRow" numberOfLines={2}>
        {trail.title}
      </AppText>
      {trail.description ? (
        <AppText variant="body" tone="textSecondary" numberOfLines={2}>
          {trail.description}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
        {meta}
      </AppText>
    </Tap>
  );
});

/** Trails: reading paths people made. One filter (the area chips) and one action (New trail). */
export function TrailsScreen() {
  const t = useT();
  const colors = useColors();
  const [chip, setChip] = useState(ALL);
  const trails = useTrails(chip === ALL ? undefined : chip);
  const renderItem = useCallback(({ item }: { item: Trail }) => <TrailRow trail={item} />, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('trails.title')} right={<Button label={t('trails.new')} icon={Plus} kind="ghost" size="sm" onPress={() => go.newTrail()} />} />
      <FlashList
        data={trails.items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <AppText variant="body" tone="textSecondary" style={styles.intro}>
              {t('research.trailsHint')}
            </AppText>
            <FieldChips value={chip} onChange={setChip} style={styles.chips} />
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
          </View>
        }
        ItemSeparatorComponent={SurfaceDivider}
        ListEmptyComponent={
          trails.isPending ? (
            <RowsSkeleton rows={3} />
          ) : trails.isError ? (
            <ErrorState onRetry={() => void trails.refetch()} />
          ) : (
            <EmptyState icon={Path} message={t('trails.empty')} actionLabel={t('trails.new')} onAction={() => go.newTrail()} />
          )
        }
        onEndReached={trails.loadMore}
        ListFooterComponent={<ListFooter loading={trails.isFetchingNextPage} />}
        refreshControl={<RefreshControl refreshing={trails.isRefetching && !trails.isFetchingNextPage} onRefresh={() => void trails.refetch()} tintColor={colors.accent} />}
      />
    </View>
  );
}

export function SurfaceDivider() {
  const colors = useColors();
  return (
    <View style={{ backgroundColor: colors.surface }}>
      <Divider />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingTop: space.md },
  intro: { paddingHorizontal: layout.screenPadding, paddingBottom: space.md },
  chips: { flexGrow: 0, paddingBottom: space.md },
  rule: { height: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: layout.screenPadding, paddingVertical: space.lg, gap: space.xs + 2 },
  tags: { flexDirection: 'row', gap: space.sm },
});
