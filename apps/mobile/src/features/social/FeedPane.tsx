import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useDeletePost, useFeed, useMe, useToggleLike, useToggleSavePost } from '@/api/social';
import type { Post } from '@/api/types';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { ListFooter } from '@/ui/Bits';
import { Users } from '@/ui/icons';
import { Bone, Pulse } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import type { ScrollableHandle } from '../research/ResearchHome';
import { postMenu } from './menus';
import { PostCard } from './PostCard';
import { SuggestedPeople } from './SuggestedPeople';
import { AreaRail } from '../home/AreaRail';

/** Home › Feed: posts from people you follow, newest first (no algorithmic feed in v1). */
export const FeedPane = forwardRef<ScrollableHandle, { onOpenResearch: () => void }>(function FeedPane({ onOpenResearch }, ref) {
  const t = useT();
  const colors = useColors();
  const feed = useFeed();
  const me = useMe();
  const like = useToggleLike();
  const save = useToggleSavePost();
  const remove = useDeletePost();
  const listRef = useRef<FlashListRef<Post>>(null);

  useImperativeHandle(ref, () => ({ scrollToTop: () => listRef.current?.scrollToOffset({ offset: 0, animated: true }) }), []);

  const onLike = useCallback((post: Post, value: boolean) => like.mutate({ post, like: value }), [like]);
  const onSave = useCallback((id: string, value: boolean) => save.mutate({ id, save: value }), [save]);
  const onMore = useCallback((post: Post) => postMenu(post, post.author.id === me.data?.id, (id) => remove.mutate(id)), [me.data?.id, remove]);
  const renderItem = useCallback(({ item }: { item: Post }) => <PostCard post={item} onLike={onLike} onSave={onSave} onMore={onMore} />, [onLike, onSave, onMore]);

  let empty: React.ReactElement;
  if (feed.isPending) empty = <FeedSkeleton />;
  else if (feed.isError) empty = <ErrorState onRetry={() => void feed.refetch()} />;
  else
    empty = (
      <EmptyState
        icon={Users}
        title={t('feed.emptyTitle')}
        message={t('feed.emptyBody')}
        actionLabel={t('feed.openResearch')}
        onAction={onOpenResearch}
        secondaryLabel={t('feed.explore')}
        onSecondary={go.explore}
      />
    );

  return (
    <FlashList
      ref={listRef}
      data={feed.items}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      getItemType={(item) => item.type}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={
        <View>
          <AreaRail />
          {feed.items.length < 5 && !feed.isPending ? <SuggestedPeople /> : null}
        </View>
      }
      ListEmptyComponent={empty}
      onEndReached={feed.loadMore}
      onEndReachedThreshold={1.5}
      ListFooterComponent={<ListFooter loading={feed.isFetchingNextPage} done={!feed.hasNextPage && feed.items.length > 3} doneLabel={t('feed.caughtUp')} />}
      refreshControl={<RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => void feed.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
    />
  );
});

function Gap() {
  return <View style={styles.gap} />;
}

function FeedSkeleton() {
  return (
    <Pulse style={styles.skeleton}>
      {[0, 1].map((i) => (
        <View key={i} style={styles.skeletonPost}>
          <View style={styles.skeletonHeader}>
            <Bone width={40} height={40} round />
            <View style={styles.skeletonLines}>
              <Bone width="40%" height={12} />
              <Bone width="25%" height={10} />
            </View>
          </View>
          <Bone width="100%" height={260} />
          <Bone width="60%" height={12} />
        </View>
      ))}
    </Pulse>
  );
}

const styles = StyleSheet.create({
  gap: { height: space.sm },
  skeleton: { gap: space.xxl, paddingTop: space.md },
  skeletonPost: { gap: space.md, paddingHorizontal: 16 },
  skeletonHeader: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  skeletonLines: { flex: 1, gap: space.sm },
});
