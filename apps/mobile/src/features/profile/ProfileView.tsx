import { FlashList } from '@shopify/flash-list';
import { useScrollToTop , router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/api/client';
import { useUserReading, useUserTrails } from '@/api/research';
import { useBlock, useFollow, useUser, useUserPosts } from '@/api/social';
import type { Post, Profile } from '@/api/types';
import { compactNumber, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { confirm, showActions } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Divider, ListFooter, SectionLabel } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { CaretLeft, DotsThree, Flag, Gear, ImageGlyph, Lock, Prohibit } from '@/ui/icons';
import { SegmentedTabs } from '@/ui/SegmentedTabs';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { PostTile } from '../explore/PostTile';
import { STEP_LABEL } from '../research/ReadingDots';
import { TrailRow } from '../research/TrailsScreen';
import { reportFlow } from '../social/menus';

type Tab = 'posts' | 'research';
const GAP = 2;

/** A profile, yours (tab) or someone else's (pushed). */
export function ProfileView({ userId, isTab }: { userId: string | undefined; isTab?: boolean }) {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const user = useUser(userId);
  const [tab, setTab] = useState<Tab>('posts');
  const profile = user.data;
  const locked = !!profile && profile.is_private && !profile.is_me && profile.follow_status !== 'accepted';
  const posts = useUserPosts(locked ? undefined : userId);
  const list = useRef(null);
  useScrollToTop(list);
  const size = Math.min(width, 720) / 3 - GAP;
  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <View style={styles.cell}>
        <PostTile post={item} size={size} />
      </View>
    ),
    [size],
  );
  const options = useMemo(
    () => [
      { value: 'posts' as const, label: t('profile.tabPosts') },
      { value: 'research' as const, label: t('profile.tabResearch') },
    ],
    [t],
  );

  const top = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      {isTab ? <View style={styles.spacer} /> : <IconButton icon={CaretLeft} label={t('a11y.back')} onPress={() => router.back()} />}
      <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
        {profile?.username ?? ''}
      </AppText>
      {profile?.is_me ? <IconButton icon={Gear} label={t('profile.settings')} onPress={go.settings} /> : profile ? <OtherMenu profile={profile} /> : null}
    </View>
  );

  if (user.isPending || !userId) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        {top}
        <RowsSkeleton rows={2} avatar />
      </View>
    );
  }
  if (user.isError || !profile) {
    const missing = user.error instanceof ApiError && user.error.status === 404;
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        {top}
        {missing ? <EmptyState icon={Prohibit} message={t('profile.unavailable')} /> : <ErrorState onRetry={() => void user.refetch()} />}
      </View>
    );
  }

  const header = (
    <View>
      <ProfileHeader profile={profile} />
      {locked ? null : <SegmentedTabs options={options} value={tab} onChange={setTab} />}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {top}
      <FlashList
        ref={list}
        data={tab === 'posts' && !locked ? posts.items : []}
        numColumns={3}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ItemSeparatorComponent={GridGap}
        ListEmptyComponent={
          locked ? (
            <EmptyState icon={Lock} title={t('profile.private')} message={t('profile.privateBody')} />
          ) : tab === 'research' ? (
            <ResearchTab userId={profile.id} />
          ) : posts.isPending ? (
            <RowsSkeleton rows={2} />
          ) : (
            <EmptyState icon={ImageGlyph} message={profile.is_me ? t('profile.noPostsMine') : t('profile.noPosts')} />
          )
        }
        onEndReached={posts.loadMore}
        ListFooterComponent={<ListFooter loading={posts.isFetchingNextPage} />}
        refreshControl={<RefreshControl refreshing={user.isRefetching} onRefresh={() => void Promise.all([user.refetch(), posts.refetch()])} tintColor={colors.accent} />}
      />
    </View>
  );
}

function GridGap() {
  return <View style={{ height: GAP }} />;
}

function ProfileHeader({ profile }: { profile: Profile }) {
  const t = useT();
  const follow = useFollow();
  const name = profile.display_name ?? profile.username;
  const count = (value: number, label: string) => (
    <View style={styles.count}>
      <AppText variant="title">{compactNumber(value)}</AppText>
      <AppText variant="caption" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );

  let action: React.ReactElement;
  if (profile.is_me) action = <Button label={t('profile.edit')} kind="secondary" block onPress={go.editProfile} />;
  else if (profile.follow_status === 'accepted')
    action = (
      <Button
        label={t('profile.followingButton')}
        kind="secondary"
        block
        onPress={async () => {
          if (await confirm({ title: t('profile.unfollowConfirm', { name: profile.username }), confirmLabel: t('profile.unfollow'), destructive: true }))
            follow.mutate({ user: profile, follow: false });
        }}
      />
    );
  else if (profile.follow_status === 'pending') action = <Button label={t('profile.requested')} kind="secondary" block onPress={() => follow.mutate({ user: profile, follow: false })} />;
  else action = <Button label={t('profile.follow')} block onPress={() => follow.mutate({ user: profile, follow: true, isPrivate: profile.is_private })} />;

  return (
    <View style={styles.header}>
      <View style={styles.identity}>
        <Avatar url={profile.avatar_url} name={name} size={88} />
        <View style={styles.counts}>
          {count(profile.posts_count, t('profile.posts'))}
          {count(profile.followers_count, t('profile.followers'))}
          {count(profile.following_count, t('profile.following'))}
        </View>
      </View>
      <View style={styles.bio}>
        <AppText variant="bodyStrong">{name}</AppText>
        {profile.bio ? <AppText variant="body">{profile.bio}</AppText> : null}
      </View>
      {action}
    </View>
  );
}

function OtherMenu({ profile }: { profile: Profile }) {
  const t = useT();
  const block = useBlock();
  return (
    <IconButton
      icon={DotsThree}
      weight="bold"
      label={t('profile.options')}
      onPress={() =>
        showActions({
          actions: [
            { label: t('profile.reportAccount'), icon: Flag, destructive: true, onPress: () => reportFlow('user', profile.id) },
            {
              label: t('common.block'),
              icon: Prohibit,
              destructive: true,
              onPress: async () => {
                if (await confirm({ title: t('profile.blockConfirm', { name: profile.username }), confirmLabel: t('common.block'), destructive: true })) {
                  block.mutate({ userId: profile.id, block: true }, { onSuccess: () => router.back() });
                }
              },
            },
          ],
        })
      }
    />
  );
}

/** Profile › Research: what they read (this month, all time) and the trails they published. */
function ResearchTab({ userId }: { userId: string }) {
  const t = useT();
  const colors = useColors();
  const reading = useUserReading(userId);
  const trails = useUserTrails(userId);
  const published = trails.items.filter((trail) => trail.status === 'published');
  const r = reading.data;
  return (
    <View style={styles.research}>
      <SectionLabel label={t('profile.reading')} />
      {r?.visible && r.this_month && r.total ? (
        <View style={[styles.statsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {([1, 2, 3] as const).map((step) => (
            <View key={step} style={styles.stat}>
              <AppText variant="title">{[r.total!.explored, r.total!.studied, r.total!.reproduced][step - 1]}</AppText>
              <AppText variant="caption" tone="textSecondary">
                {t(STEP_LABEL[step])}
              </AppText>
              <AppText variant="micro" tone="accent">
                {`+${[r.this_month!.explored, r.this_month!.studied, r.this_month!.reproduced][step - 1]} ${t('lib.thisMonth')}`}
              </AppText>
            </View>
          ))}
        </View>
      ) : reading.isPending ? (
        <RowsSkeleton rows={1} />
      ) : null}
      <SectionLabel label={t('profile.trails')} />
      {trails.isPending ? <RowsSkeleton rows={2} /> : null}
      {!trails.isPending && !published.length ? (
        <AppText variant="body" tone="textSecondary" style={styles.pad}>
          {t('profile.noTrails')}
        </AppText>
      ) : null}
      {published.length ? (
        <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {published.map((trail, i) => (
            <View key={trail.id}>
              {i > 0 ? <Divider /> : null}
              <TrailRow trail={trail} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  spacer: { width: space.md },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingRight: space.xs },
  header: { paddingHorizontal: layout.screenPadding, paddingTop: space.sm, paddingBottom: space.lg, gap: space.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  counts: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  count: { alignItems: 'center' },
  bio: { gap: 2 },
  cell: { paddingHorizontal: GAP / 2 },
  research: { paddingBottom: space.x4 },
  statsRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.lg },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  pad: { paddingHorizontal: layout.screenPadding },
  surface: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
});
