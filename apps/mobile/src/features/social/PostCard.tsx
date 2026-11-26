import { Image } from 'expo-image';
import { memo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import type { Post } from '@/api/types';
import { compactNumber, relativeTime, useLang, useT } from '@/i18n';
import { shareLink } from '@/lib/share';
import { go } from '@/shell/nav';
import { useArea, useTextPostPaint } from '@/theme/area';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { BookmarkSimple, ChatCircle, DotsThree, Heart, PaperPlaneTilt, Play } from '@/ui/icons';
import { Tap } from '@/ui/Tap';
import { AreaGlyph } from '../fields';

interface PostCardProps {
  post: Post;
  onLike: (post: Post, like: boolean) => void;
  onSave: (id: string, save: boolean) => void;
  onMore: (post: Post) => void;
  /** Width the media fills (the screen width in the feed). */
  width?: number;
}

const DOUBLE_TAP_MS = 260;
/** Text posts up to this length are set large on their area's colour, like a coloured status. */
const SHORT_TEXT = 180;

/**
 * A post in the feed, in the familiar order: author row, media full-bleed, actions with their
 * counts, caption, "view comments". Double-tap the media to like (with a heart pop). Short text
 * posts sit on a block of their area's colour; long ones read as text. Reels show a poster that
 * opens the full-screen viewer.
 */
export const PostCard = memo(function PostCard({ post, onLike, onSave, onMore, width: widthProp }: PostCardProps) {
  const colors = useColors();
  const t = useT();
  const lang = useLang();
  const area = useArea(post.topic?.field);
  const paint = useTextPostPaint(post.topic?.field);
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
  const colourBlock = post.type === 'text' && caption.length <= SHORT_TEXT;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Tap onPress={() => go.user(post.author.id)} accessibilityLabel={t('a11y.openProfile', { name })}>
          <Avatar url={post.author.avatar_url} name={name} size={36} />
        </Tap>
        <View style={styles.authorText}>
          <Tap feedback="none" onPress={() => go.user(post.author.id)} style={styles.nameTap} importantForAccessibility="no" accessibilityElementsHidden>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {post.author.username}
            </AppText>
          </Tap>
          <View style={styles.subline}>
            {post.topic ? (
              <Tap
                feedback="none"
                onPress={() => go.topic(post.topic!.slug)}
                hitSlop={6}
                accessibilityLabel={`${t('learn.topic')}: ${post.topic.name}`}
                style={styles.topicLink}
              >
                <AreaGlyph slug={post.topic.field} size={12} weight="fill" color={area.ink} />
                <AppText variant="caption" weight="medium" tone="text" numberOfLines={1} style={styles.topicName}>
                  {post.topic.name}
                </AppText>
              </Tap>
            ) : null}
            <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
              {post.topic ? ` · ${relativeTime(post.created_at, lang)}` : relativeTime(post.created_at, lang)}
            </AppText>
          </View>
        </View>
        <Tap onPress={() => onMore(post)} accessibilityLabel={t('post.options')} style={styles.more} hitSlop={4}>
          <DotsThree size={22} weight="bold" color={colors.textSecondary} />
        </Tap>
      </View>

      {post.type === 'text' ? (
        colourBlock ? (
          <Tap feedback="none" onPress={onMediaPress} accessibilityLabel={caption} style={[styles.block, { backgroundColor: paint.bg }]}>
            <AreaGlyph slug={post.topic?.field} size={22} weight="fill" color={paint.fg} style={styles.blockGlyph} />
            <AppText variant="lead" weight="regular" tone="text" style={styles.blockText}>
              {caption}
            </AppText>
            <Animated.View pointerEvents="none" style={[styles.heartOverlay, heartStyle]}>
              <Heart size={72} weight="fill" color={colors.like} />
            </Animated.View>
          </Tap>
        ) : (
          <Tap feedback="none" onPress={onMediaPress} accessibilityLabel={caption} style={styles.textBody}>
            <AppText variant="reading" numberOfLines={expanded ? undefined : 7}>
              {caption}
            </AppText>
            {!expanded ? (
              <Tap feedback="none" onPress={() => setExpanded(true)} hitSlop={8}>
                <AppText variant="label" tone="textTertiary">
                  {t('common.more')}
                </AppText>
              </Tap>
            ) : null}
            <Animated.View pointerEvents="none" style={[styles.heartOverlay, heartStyle]}>
              <Heart size={72} weight="fill" color={colors.like} />
            </Animated.View>
          </Tap>
        )
      ) : (
        <Tap
          feedback="none"
          onPress={onMediaPress}
          accessibilityLabel={post.type === 'reel' ? t('post.playReel') : caption || t('post.title')}
          style={{ width, height: width / aspect, backgroundColor: colors.elevated }}
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
        <Tap
          onPress={() => onLike(post, !post.liked_by_me)}
          accessibilityLabel={post.liked_by_me ? t('post.unlike') : t('post.like')}
          accessibilityState={{ selected: post.liked_by_me }}
          style={styles.action}
        >
          <Heart size={24} weight={post.liked_by_me ? 'fill' : 'regular'} color={post.liked_by_me ? colors.like : colors.text} />
          {post.like_count > 0 ? (
            <AppText variant="label" weight="semibold">
              {compactNumber(post.like_count)}
            </AppText>
          ) : null}
        </Tap>
        <Tap onPress={() => go.comments('posts', post.id)} accessibilityLabel={t('post.comment')} style={styles.action}>
          <ChatCircle size={24} color={colors.text} />
          {post.comment_count > 0 ? (
            <AppText variant="label" weight="semibold">
              {compactNumber(post.comment_count)}
            </AppText>
          ) : null}
        </Tap>
        <Tap onPress={() => void shareLink(post.share_url)} accessibilityLabel={t('common.share')} style={styles.action}>
          <PaperPlaneTilt size={23} color={colors.text} />
        </Tap>
        <View style={styles.flex} />
        <Tap
          onPress={() => onSave(post.id, !post.saved_by_me)}
          accessibilityLabel={post.saved_by_me ? t('post.unsave') : t('post.save')}
          accessibilityState={{ selected: post.saved_by_me }}
          style={styles.action}
        >
          <BookmarkSimple size={24} weight={post.saved_by_me ? 'fill' : 'regular'} color={post.saved_by_me ? colors.accent : colors.text} />
        </Tap>
      </View>

      {post.type !== 'text' && caption ? (
        <Tap feedback="none" onPress={() => setExpanded((e) => !e)} accessibilityRole="text" style={styles.caption}>
          <AppText variant="body" numberOfLines={expanded ? undefined : 2}>
            <AppText variant="bodyStrong">{`${post.author.username} `}</AppText>
            <AppText variant="body">{caption}</AppText>
          </AppText>
        </Tap>
      ) : null}
      {post.comment_count > 1 ? (
        <Tap feedback="none" onPress={() => go.comments('posts', post.id)} style={styles.caption}>
          <AppText variant="caption" tone="textTertiary">
            {t('post.viewComments', { n: post.comment_count })}
          </AppText>
        </Tap>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { paddingBottom: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: layout.screenPadding - 4, paddingRight: space.xs, paddingVertical: space.sm, gap: space.sm },
  authorText: { flex: 1, gap: 1, marginLeft: 2 },
  nameTap: { alignSelf: 'flex-start' },
  subline: { flexDirection: 'row', alignItems: 'center' },
  topicLink: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  topicName: { flexShrink: 1 },
  more: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  block: { minHeight: 168, paddingHorizontal: layout.screenPadding + space.xs, paddingVertical: space.xl, justifyContent: 'center', overflow: 'hidden' },
  blockGlyph: { position: 'absolute', top: space.lg, left: space.xl, opacity: 0.85 },
  blockText: { marginTop: space.lg },
  textBody: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xs, gap: space.xs },
  processing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', top: space.md, right: space.md, width: 28, height: 28, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  heartOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, paddingTop: space.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: space.sm },
  flex: { flex: 1 },
  caption: { paddingHorizontal: layout.screenPadding, paddingBottom: space.xs },
});
