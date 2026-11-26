import { memo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useReplies } from '@/api/social';
import type { Comment } from '@/api/types';
import { relativeTime, useLang, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Tap } from '@/ui/Tap';

interface CommentRowProps {
  comment: Comment;
  onReply?: (comment: Comment) => void;
  onLongPress?: (comment: Comment) => void;
  /** Replies are indented under their parent. */
  depth?: number;
  /** Load and show replies inline ("View 3 replies"). */
  expandable?: boolean;
}

/**
 * One comment: avatar 32, username, time, body, Reply. The same row serves post comments and
 * paper discussion. Deleted comments keep their place with a placeholder.
 */
export const CommentRow = memo(function CommentRow({ comment, onReply, onLongPress, depth = 0, expandable = true }: CommentRowProps) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const replies = useReplies(comment.id, open);
  const name = comment.author?.display_name ?? comment.author?.username ?? '';

  return (
    <View>
      <Tap
        feedback="none"
        onLongPress={onLongPress && !comment.is_deleted ? () => onLongPress(comment) : undefined}
        style={[styles.row, { paddingLeft: layout.screenPadding + depth * 44 }]}
        accessibilityRole="text"
      >
        {comment.author ? (
          <Tap onPress={() => go.user(comment.author!.id)} accessibilityLabel={t('a11y.openProfile', { name })}>
            <Avatar url={comment.author.avatar_url} name={name} size={32} />
          </Tap>
        ) : (
          <View style={[styles.ghost, { backgroundColor: colors.elevated }]} />
        )}
        <View style={styles.body}>
          <AppText variant="caption" tone="textTertiary">
            {comment.author ? (
              <AppText variant="label" weight="bold" tone="text">{`${comment.author.username}  `}</AppText>
            ) : null}
            {relativeTime(comment.created_at, lang)}
          </AppText>
          {comment.is_deleted || !comment.body ? (
            <AppText variant="body" tone="textTertiary" italic>
              {t('comments.deletedBody')}
            </AppText>
          ) : (
            <AppText variant="body">{comment.body}</AppText>
          )}
          {onReply && !comment.is_deleted ? (
            <Tap onPress={() => onReply(comment)} hitSlop={10} style={styles.reply}>
              <AppText variant="label" tone="textTertiary">
                {t('comments.reply')}
              </AppText>
            </Tap>
          ) : null}
        </View>
      </Tap>
      {expandable && comment.reply_count > 0 ? (
        <Tap onPress={() => setOpen((o) => !o)} style={[styles.toggle, { paddingLeft: layout.screenPadding + (depth + 1) * 44 }]}>
          <View style={[styles.rule, { backgroundColor: colors.border }]} />
          <AppText variant="label" tone="textTertiary">
            {open ? t('comments.hideReplies') : comment.reply_count === 1 ? t('comments.viewReply') : t('comments.viewReplies', { n: comment.reply_count })}
          </AppText>
          {open && replies.isPending ? <ActivityIndicator size="small" color={colors.textTertiary} /> : null}
        </Tap>
      ) : null}
      {open
        ? replies.items.map((reply) => (
            <CommentRow key={reply.id} comment={reply} onReply={onReply} onLongPress={onLongPress} depth={Math.min(depth + 1, 2)} expandable />
          ))
        : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingRight: layout.screenPadding, paddingVertical: space.sm },
  ghost: { width: 32, height: 32, borderRadius: 16 },
  body: { flex: 1, gap: 2 },
  reply: { alignSelf: 'flex-start', paddingVertical: space.xs },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, paddingRight: layout.screenPadding },
  rule: { width: 24, height: StyleSheet.hairlineWidth },
});
