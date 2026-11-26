import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ApiError } from '@/api/client';
import { useComments, useDeletePost, useMe, usePost, useToggleLike, useToggleSavePost } from '@/api/social';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { ImageGlyph } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { CommentRow } from './CommentRow';
import { postMenu } from './menus';
import { PostCard } from './PostCard';

/** One post (from Explore, a profile grid or a notification) with its first comments. */
export function PostScreen({ id }: { id: string }) {
  const t = useT();
  const colors = useColors();
  const post = usePost(id);
  const me = useMe();
  const like = useToggleLike();
  const save = useToggleSavePost();
  const remove = useDeletePost();
  const comments = useComments({ kind: 'posts', id });

  let body: React.ReactElement;
  if (post.isPending) body = <RowsSkeleton rows={3} avatar />;
  else if (post.isError || !post.data) {
    const missing = post.error instanceof ApiError && post.error.status === 404;
    body = missing ? <EmptyState icon={ImageGlyph} message={t('post.unavailable')} /> : <ErrorState onRetry={() => void post.refetch()} />;
  } else {
    const data = post.data;
    body = (
      <ScrollView contentContainerStyle={styles.scroll}>
        <PostCard
          post={data}
          onLike={(p, value) => like.mutate({ post: p, like: value })}
          onSave={(pid, value) => save.mutate({ id: pid, save: value })}
          onMore={(p) => postMenu(p, p.author.id === me.data?.id, (pid) => remove.mutate(pid, { onSuccess: () => router.back() }))}
        />
        <View style={[styles.comments, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          {comments.items.slice(0, 5).map((comment) => (
            <CommentRow key={comment.id} comment={comment} onReply={() => go.comments('posts', id, true)} expandable={false} />
          ))}
          <Button label={t('comments.placeholder')} kind="secondary" onPress={() => go.comments('posts', id, true)} style={styles.write} />
        </View>
      </ScrollView>
    );
  }
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('post.title')} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: space.x4 },
  comments: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.sm },
  write: { marginHorizontal: 16, marginTop: space.sm },
});
