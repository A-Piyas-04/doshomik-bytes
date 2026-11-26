import { noOutline } from '@/ui/noOutline';
import { FlashList } from '@shopify/flash-list';
import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAddComment, useComments, useDeleteComment, useMe, type Thread } from '@/api/social';
import type { Comment } from '@/api/types';
import { useT } from '@/i18n';
import { hasBengali } from '@/lib/script';
import { fontFamily } from '@/theme/fonts';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { confirm, showActions } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { ListFooter } from '@/ui/Bits';
import { IconButton } from '@/ui/IconButton';
import { ChatCircle, Flag, PaperPlaneTilt, Trash, X } from '@/ui/icons';
import { KeyboardView } from '@/ui/Keyboard';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { CommentRow } from './CommentRow';
import { reportFlow } from './menus';

/**
 * A comment thread: post comments or a paper's discussion (one table, one screen). Top-level
 * comments oldest first, replies shown under their parent, the input pinned above the keyboard.
 * Long-press a comment to delete yours or report someone else's.
 */
export function CommentsScreen({ thread, focus }: { thread: Thread; focus?: boolean }) {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const comments = useComments(thread);
  const add = useAddComment(thread);
  const remove = useDeleteComment(thread);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  const onReply = useCallback((comment: Comment) => {
    setReplyTo(comment);
    input.current?.focus();
  }, []);
  const onLongPress = useCallback(
    (comment: Comment) => {
      const mine = comment.author?.id === me.data?.id;
      showActions({
        actions: mine
          ? [
              {
                label: t('common.delete'),
                icon: Trash,
                destructive: true,
                onPress: async () => {
                  if (await confirm({ title: t('comments.deleteConfirm'), confirmLabel: t('common.delete'), destructive: true })) remove.mutate(comment);
                },
              },
            ]
          : [{ label: t('common.report'), icon: Flag, destructive: true, onPress: () => reportFlow('comment', comment.id) }],
      });
    },
    [me.data?.id, remove, t],
  );
  const renderItem = useCallback(({ item }: { item: Comment }) => <CommentRow comment={item} onReply={onReply} onLongPress={onLongPress} />, [onReply, onLongPress]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    add.mutate(
      { body, parentId: replyTo?.id },
      {
        onSuccess: () => {
          setText('');
          setReplyTo(null);
        },
      },
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <ScreenHeader surface title={thread.kind === 'papers' ? t('paper.tabDiscussion') : t('comments.title')} />
      <KeyboardView>
        <FlashList
          data={comments.items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            comments.isPending ? (
              <RowsSkeleton rows={3} avatar />
            ) : comments.isError ? (
              <ErrorState onRetry={() => void comments.refetch()} />
            ) : (
              <EmptyState icon={ChatCircle} message={thread.kind === 'papers' ? t('paper.discussionEmpty') : t('comments.empty')} />
            )
          }
          onEndReached={comments.loadMore}
          ListFooterComponent={<ListFooter loading={comments.isFetchingNextPage} />}
        />
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
          {replyTo ? (
            <View style={styles.replying}>
              <AppText variant="caption" tone="textSecondary" style={styles.flex}>
                {t('comments.replyPlaceholder', { name: replyTo.author?.username ?? '' })}
              </AppText>
              <IconButton icon={X} size={16} label={t('comments.cancelReply')} onPress={() => setReplyTo(null)} />
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <Avatar url={me.data?.avatar_url} name={me.data?.display_name ?? me.data?.username ?? '?'} size={32} />
            <TextInput
              ref={input}
              autoFocus={focus}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={2000}
              placeholder={replyTo ? t('comments.replyPlaceholder', { name: replyTo.author?.username ?? '' }) : t('comments.placeholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              accessibilityLabel={t('comments.placeholder')}
              style={[noOutline, 
                styles.input,
                { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, fontFamily: fontFamily('sans', 'regular', hasBengali(text) ? 'bengali' : 'latin') },
              ]}
            />
            <IconButton
              icon={PaperPlaneTilt}
              weight="fill"
              color={text.trim() ? colors.accent : colors.textTertiary}
              label={t('comments.send')}
              disabled={!text.trim() || add.isPending}
              onPress={send}
            />
          </View>
        </View>
      </KeyboardView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  list: { paddingVertical: space.sm },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, paddingHorizontal: layout.screenPadding, gap: space.xs },
  replying: { flexDirection: 'row', alignItems: 'center', marginLeft: 44, marginRight: -space.sm },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: space.md, paddingTop: 10, paddingBottom: 10, fontSize: 15 },
});
