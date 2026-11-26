import { Image } from 'expo-image';
import { memo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import type { Post } from '@/api/types';
import { compactNumber, relativeTime, useLang, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Tag } from '@/ui/Bits';
import { IconButton } from '@/ui/IconButton';
import { BookmarkSimple, ChatCircle, DotsThree, Heart, Play } from '@/ui/icons';
import { Tap } from '@/ui/Tap';

interface PostCardProps {
  post: Post;
  onLike: (post: Post, like: boolean) => void;
  onSave: (id: string, save: boolean) => void;
  onMore: (post: Post) => void;
  /** Width the media fills (the screen width in the feed). */
  width?: number;
}

const DOUBLE_TAP_MS = 260;

/**
 * A post in the feed, in the familiar order: author row, media full-bleed, actions, likes,
 * caption, "view comments". Double-tap the media to like (with a heart pop). Text posts set their
 * text as the body; reels show a poster that opens the full-screen viewer.
 */
export const PostCard = memo(function PostCard({ post, onLike, onSave, onMore, width: widthProp }: PostCardProps) {
  const colors = useColors();
  const t = useT();
  const lang = useLang();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(widthProp ?? screen, 640);
  const [expanded, setExpanded] = useState(false);
  const lastTap = useRef(0);
  const heart = useSharedValue(0);
  const heartStyle = useAnimatedStyle(() => ({ opacity: heart.get(), transform: [{ scale: 0.6 + heart.get() * 0.5 }] }));
  const name = post.author.display_name ?? post.author.username;

  const like = () => {
    heart.set(withSequence(withSpring(1, { damping: 12, stiffness: 260 }), withTiming(0, { duration: 380 })));
    if (!post.liked_by_me) onLike(post, true);
  };
  const onMediaPress = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      like();
    } else {
      lastTap.current = now;
      if (post.type === 'reel') setTimeout(() => lastTap.current !== 0 && go.reel(post.id), DOUBLE_TAP_MS);
    }
  };

  const media = post.media;
  const aspect = media?.width && media?.height ? Math.min(Math.max(media.width / media.height, 0.8), 1.91) : post.type === 'reel' ? 0.8 : 1;
  const caption = post.caption ?? '';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.header}>
        <Tap onPress={() => go.user(post.author.id)} style={styles.author} accessibilityLabel={t('a11y.openProfile', { name })}>
          <Avatar url={post.author.avatar_url} name={name} size={40} />
          <View style={styles.authorText}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {post.author.username}
            </AppText>
            <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
              {relativeTime(post.created_at, lang)}
            </AppText>
          </View>
        </Tap>
        {post.topic ? (
          <Tap onPress={() => go.topic(post.topic!.slug)} hitSlop={8} accessibilityLabel={`${t('learn.topic')}: ${post.topic.name}`}>
            <Tag label={post.topic.name} tone="accent" />
          </Tap>
        ) : null}
        <IconButton icon={DotsThree} weight="bold" label={t('post.options')} onPress={() => onMore(post)} />
      </View>

      {post.type === 'text' ? (
        <Tap feedback="none" onPress={onMediaPress} accessibilityLabel={caption} style={styles.textBody}>
          <AppText variant={caption.length < 160 ? 'lead' : 'reading'} numberOfLines={expanded ? undefined : 8}>
            {caption}
          </AppText>
          <Animated.View pointerEvents="none" style={[styles.heartOverlay, heartStyle]}>
            <Heart size={72} weight="fill" color={colors.like} />
          </Animated.View>
        </Tap>
      ) : (
        <Tap
          feedback="none"
          onPress={onMediaPress}
          accessibilityLabel={post.type === 'reel' ? t('post.playReel') : caption || t('post.title')}
          style={{ width, height: width / aspect, backgroundColor: colors.surface }}
        >
          {post.status === 'processing' || !media?.url ? (
            <View style={styles.processing}>
              <AppText variant="caption" tone="textSecondary">
                {t('post.processing')}
              </AppText>
            </View>
          ) : (
            <Image
              source={{ uri: post.type === 'reel' ? (media.thumbnail_url ?? undefined) : media.url }}
              placeholder={media.thumbnail_url && post.type !== 'reel' ? { uri: media.thumbnail_url } : undefined}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={150}
              recyclingKey={post.id}
            />
          )}
          {post.type === 'reel' ? (
            <View style={[styles.playBadge, { backgroundColor: colors.scrim }]}>
              <Play size={16} weight="fill" color="#FFFFFF" />
            </View>
          ) : null}
          <Animated.View pointerEvents="none" style={[styles.heartOverlay, heartStyle]}>
            <Heart size={88} weight="fill" color="#FFFFFF" />
          </Animated.View>
        </Tap>
      )}

      <View style={styles.actions}>
        <IconButton
          icon={Heart}
          weight={post.liked_by_me ? 'fill' : 'regular'}
          color={post.liked_by_me ? colors.like : colors.text}
          label={post.liked_by_me ? t('post.unlike') : t('post.like')}
          selected={post.liked_by_me}
          onPress={() => onLike(post, !post.liked_by_me)}
        />
        <IconButton icon={ChatCircle} label={t('post.comment')} onPress={() => go.comments('posts', post.id)} />
        <View style={styles.flex} />
        <IconButton
          icon={BookmarkSimple}
          weight={post.saved_by_me ? 'fill' : 'regular'}
          label={post.saved_by_me ? t('post.unsave') : t('post.save')}
          selected={post.saved_by_me}
          onPress={() => onSave(post.id, !post.saved_by_me)}
        />
      </View>

      <View style={styles.meta}>
        {post.like_count > 0 ? (
          <AppText variant="bodyStrong">{post.like_count === 1 ? t('post.likesOne') : t('post.likes', { n: compactNumber(post.like_count) })}</AppText>
        ) : null}
        {post.type !== 'text' && caption ? (
          <Tap feedback="none" onPress={() => setExpanded((e) => !e)} accessibilityRole="text">
            <AppText variant="body" numberOfLines={expanded ? undefined : 2}>
              <AppText variant="bodyStrong">{`${post.author.username} `}</AppText>
              <AppText variant="body">{caption}</AppText>
            </AppText>
          </Tap>
        ) : null}
        {post.type === 'text' && !expanded && caption.length > 420 ? (
          <Tap feedback="none" onPress={() => setExpanded(true)}>
            <AppText variant="label" tone="textTertiary">
              {t('common.more')}
            </AppText>
          </Tap>
        ) : null}
        {post.comment_count > 0 ? (
          <Tap feedback="none" onPress={() => go.comments('posts', post.id)}>
            <AppText variant="label" tone="textTertiary">
              {post.comment_count === 1 ? t('post.viewComment') : t('post.viewComments', { n: post.comment_count })}
            </AppText>
          </Tap>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { paddingBottom: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: layout.screenPadding, paddingRight: space.xs, paddingVertical: space.sm },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  authorText: { flex: 1 },
  textBody: { paddingHorizontal: layout.screenPadding, paddingTop: space.xs, paddingBottom: space.sm },
  processing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', top: space.md, right: space.md, width: 28, height: 28, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  heartOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs },
  flex: { flex: 1 },
  meta: { paddingHorizontal: layout.screenPadding, gap: space.xs },
});
