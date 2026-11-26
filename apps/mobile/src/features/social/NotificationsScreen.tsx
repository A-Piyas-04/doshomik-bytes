import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useAnswerFollowRequest, useFollowRequests, useMarkNotificationRead, useNotifications } from '@/api/social';
import type { Notification } from '@/api/types';
import { relativeTime, useLang, useT, type MessageKey } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Divider, ListFooter } from '@/ui/Bits';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Bell, CaretRight, UserPlus } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';

const TEXT: Record<string, MessageKey> = {
  follow: 'notif.follow',
  follow_request: 'notif.followRequest',
  like: 'notif.like',
  comment: 'notif.comment',
  reply: 'notif.reply',
  post_ready: 'notif.postReady',
};

/**
 * Notifications: follow requests first (when there are any), then follows, likes, comments and
 * replies, newest first. Unread rows carry a dot and a faint wash; opening one marks it read and
 * goes to the post, the paper discussion or the profile.
 */
export function NotificationsScreen() {
  const t = useT();
  const colors = useColors();
  const list = useNotifications();
  const requests = useFollowRequests();
  const markRead = useMarkNotificationRead();
  const [requestsOpen, setRequestsOpen] = useState(false);

  const open = useCallback(
    (n: Notification) => {
      if (!n.is_read) markRead.mutate(n.id);
      if (n.paper_id) go.comments('papers', n.paper_id);
      else if (n.post_id && (n.type === 'comment' || n.type === 'reply')) go.comments('posts', n.post_id);
      else if (n.post_id) go.post(n.post_id);
      else if (n.type === 'follow_request') setRequestsOpen(true);
      else go.user(n.actor.id);
    },
    [markRead],
  );
  const renderItem = useCallback(({ item }: { item: Notification }) => <NotificationRow n={item} onOpen={open} />, [open]);
  const pending = requests.items.length;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('notif.title')} />
      <FlashList
        data={list.items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          pending ? (
            <Tap feedback="fill" onPress={() => setRequestsOpen(true)} style={[styles.requests, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              <View style={[styles.requestIcon, { backgroundColor: colors.accentWash }]}>
                <UserPlus size={22} color={colors.accent} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{t('notif.requests')}</AppText>
                <AppText variant="caption" tone="textSecondary">
                  {t('notif.requestsCount', { n: pending })}
                </AppText>
              </View>
              <CaretRight size={16} color={colors.textTertiary} />
            </Tap>
          ) : null
        }
        ListEmptyComponent={list.isPending ? <RowsSkeleton rows={5} avatar /> : list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : <EmptyState icon={Bell} message={t('notif.empty')} />}
        onEndReached={list.loadMore}
        ListFooterComponent={<ListFooter loading={list.isFetchingNextPage} />}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={colors.accent} />}
      />
      <FollowRequestsSheet visible={requestsOpen} onClose={() => setRequestsOpen(false)} />
    </View>
  );
}

function Separator() {
  const colors = useColors();
  return (
    <View style={{ backgroundColor: colors.surface }}>
      <Divider inset={layout.screenPadding + 60} />
    </View>
  );
}

const NotificationRow = memo(function NotificationRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const name = n.actor.display_name ?? n.actor.username;
  const key = n.type === 'comment' && n.paper_id ? 'notif.commentPaper' : (TEXT[n.type] ?? 'notif.like');
  const text = t(key, { name: n.actor.username });
  return (
    <Tap feedback="fill" onPress={() => onOpen(n)} style={[styles.row, { backgroundColor: n.is_read ? colors.surface : colors.accentWash }]} accessibilityLabel={text}>
      <Avatar url={n.actor.avatar_url} name={name} size={48} />
      <View style={styles.flex}>
        <AppText variant="body" weight={n.is_read ? 'regular' : 'medium'} numberOfLines={3}>
          {text}
        </AppText>
        <AppText variant="caption" tone="textTertiary">
          {relativeTime(n.created_at, lang)}
        </AppText>
      </View>
      {n.is_read ? null : <View style={[styles.dot, { backgroundColor: colors.accent }]} accessibilityLabel="unread" />}
    </Tap>
  );
});

function FollowRequestsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const requests = useFollowRequests();
  const answer = useAnswerFollowRequest();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('notif.requests')}>
      {requests.items.length === 0 ? (
        <AppText variant="body" tone="textSecondary" style={styles.pad}>
          {t('notif.requestsEmpty')}
        </AppText>
      ) : null}
      {requests.items.map((person) => (
        <View key={person.id} style={styles.requestRow}>
          <Avatar url={person.avatar_url} name={person.display_name ?? person.username} size={40} />
          <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
            {person.username}
          </AppText>
          <Button label={t('notif.accept')} size="sm" onPress={() => answer.mutate({ userId: person.id, accept: true })} />
          <Button label={t('notif.decline')} size="sm" kind="secondary" onPress={() => answer.mutate({ userId: person.id, accept: false })} />
        </View>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  requests: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  requestIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: layout.screenPadding, paddingVertical: space.sm },
  pad: { padding: layout.screenPadding },
});
