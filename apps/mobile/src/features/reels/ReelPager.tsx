import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useCallback, useEffect, useState } from 'react';
import { AppState, FlatList, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useDeletePost, useMe, useToggleLike, useToggleSavePost } from '@/api/social';
import type { Post } from '@/api/types';
import { compactNumber, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { BookmarkSimple, ChatCircle, DotsThree, Heart, Pause, Play, SpeakerHigh, SpeakerSlash } from '@/ui/icons';
import { Tap } from '@/ui/Tap';
import { postMenu } from '../social/menus';

type Viewable = { index?: number | null; isViewable: boolean };

const WHITE = '#FFFFFF';

/**
 * Full-height vertical paging, one reel per screen. Only the active reel plays; its neighbours keep
 * a player ready (so the next swipe starts at once), everything further away is just its poster.
 * At most three players exist at any time, and playback pauses when the screen loses focus or the
 * app goes to the background.
 */
export function ReelPager({ posts, onEndReached, header }: { posts: Post[]; onEndReached?: () => void; header?: React.ReactNode }) {
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(false);
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);

  const onViewable = useCallback(({ viewableItems }: { viewableItems: Viewable[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActive(first.index);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <ReelItem
        post={item}
        height={height}
        state={Math.abs(index - active) > 1 ? 'far' : index === active && focused && foreground ? 'playing' : 'ready'}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
      />
    ),
    [active, focused, foreground, height, muted],
  );

  return (
    <View style={styles.root} onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}>
      {height > 0 ? (
        <FlatList
          data={posts}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          pagingEnabled
          snapToInterval={height}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          onEndReached={onEndReached}
          onEndReachedThreshold={2}
        />
      ) : null}
      {header}
    </View>
  );
}

type ItemState = 'playing' | 'ready' | 'far';

const ReelItem = memo(function ReelItem({ post, height, state, muted, onToggleMute }: { post: Post; height: number; state: ItemState; muted: boolean; onToggleMute: () => void }) {
  const t = useT();
  const me = useMe();
  const like = useToggleLike();
  const save = useToggleSavePost();
  const remove = useDeletePost();
  const [expanded, setExpanded] = useState(false);
  const name = post.author.display_name ?? post.author.username;
  const url = post.media?.url;
  const poster = post.media?.thumbnail_url;

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {url && state !== 'far' ? <ReelVideo uri={url} playing={state === 'playing'} muted={muted} onToggleMute={onToggleMute} /> : null}

      <View style={[styles.scrim, { experimental_backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0))' }]} pointerEvents="none" />

      <View style={styles.rail}>
        <Tap onPress={() => go.user(post.author.id)} accessibilityLabel={t('a11y.openProfile', { name })} style={styles.railButton}>
          <Avatar url={post.author.avatar_url} name={name} size={40} />
        </Tap>
        <RailButton
          label={post.liked_by_me ? t('post.unlike') : t('post.like')}
          count={post.like_count}
          onPress={() => like.mutate({ post, like: !post.liked_by_me })}
          icon={<Heart size={30} weight="fill" color={post.liked_by_me ? '#F2545B' : WHITE} />}
        />
        <RailButton label={t('post.comment')} count={post.comment_count} onPress={() => go.comments('posts', post.id)} icon={<ChatCircle size={30} weight="fill" color={WHITE} />} />
        <RailButton
          label={post.saved_by_me ? t('post.unsave') : t('post.save')}
          onPress={() => save.mutate({ id: post.id, save: !post.saved_by_me })}
          icon={<BookmarkSimple size={28} weight="fill" color={post.saved_by_me ? '#5BC9A1' : WHITE} />}
        />
        <RailButton
          label={t('post.options')}
          onPress={() => postMenu(post, post.author.id === me.data?.id, (id) => remove.mutate(id))}
          icon={<DotsThree size={28} weight="bold" color={WHITE} />}
        />
      </View>

      <View style={styles.caption}>
        <Tap onPress={() => go.user(post.author.id)} style={styles.author}>
          <AppText variant="bodyStrong" style={styles.white}>
            {post.author.username}
          </AppText>
        </Tap>
        {post.caption ? (
          <Tap feedback="none" onPress={() => setExpanded((e) => !e)}>
            <AppText variant="body" numberOfLines={expanded ? 6 : 2} style={styles.white}>
              {post.caption}
            </AppText>
          </Tap>
        ) : null}
        {post.topic ? (
          <Tap onPress={() => go.topic(post.topic!.slug)} style={styles.topic}>
            <AppText variant="label" weight="semibold" style={styles.mint}>
              {post.topic.name}
            </AppText>
          </Tap>
        ) : null}
      </View>
    </View>
  );
});

function RailButton({ icon, label, count, onPress }: { icon: React.ReactNode; label: string; count?: number; onPress: () => void }) {
  return (
    <Tap onPress={onPress} accessibilityLabel={label} style={styles.railButton}>
      {icon}
      {count !== undefined ? (
        <AppText variant="micro" weight="semibold" style={styles.white}>
          {compactNumber(count)}
        </AppText>
      ) : null}
    </Tap>
  );
}

function ReelVideo({ uri, playing, muted, onToggleMute }: { uri: string; playing: boolean; muted: boolean; onToggleMute: () => void }) {
  const t = useT();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
  });
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const flash = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (player.duration > 0) setProgress(currentTime / player.duration);
  });
  // Leaving a reel clears a manual pause, so it plays again when the user comes back to it.
  const [wasPlaying, setWasPlaying] = useState(playing);
  if (playing !== wasPlaying) {
    setWasPlaying(playing);
    if (!playing) setPaused(false);
  }
  useEffect(() => {
    // The player is a native object, not React state: setting its properties is how it is driven.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [player, muted]);
  useEffect(() => {
    if (playing && !paused) player.play();
    else player.pause();
  }, [player, playing, paused]);

  const toggle = () => {
    setPaused((p) => !p);
    flash.set(withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 500 })));
  };

  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType="textureView" />
      <Tap feedback="none" onPress={toggle} style={StyleSheet.absoluteFill} accessibilityLabel={paused ? t('reels.play') : t('reels.pause')}>
        <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none">
          {paused ? <Pause size={56} weight="fill" color={WHITE} /> : <Play size={56} weight="fill" color={WHITE} />}
        </Animated.View>
      </Tap>
      <Tap onPress={onToggleMute} style={styles.mute} accessibilityLabel={muted ? t('reels.unmute') : t('reels.mute')}>
        {muted ? <SpeakerSlash size={20} color={WHITE} /> : <SpeakerHigh size={20} color={WHITE} />}
      </Tap>
      <View style={styles.progressTrack} pointerEvents="none">
        <View style={[styles.progressFill, { width: `${Math.min(100, progress * 100)}%` }]} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 260 },
  rail: { position: 'absolute', right: space.sm, bottom: space.x4, alignItems: 'center', gap: space.lg },
  railButton: { alignItems: 'center', minWidth: 44, minHeight: 44, justifyContent: 'center', gap: 2 },
  caption: { position: 'absolute', left: layout.screenPadding, right: 76, bottom: space.xxl, gap: space.xs },
  author: { alignSelf: 'flex-start', paddingVertical: space.xs },
  topic: { alignSelf: 'flex-start', paddingVertical: space.xs },
  white: { color: WHITE },
  mint: { color: '#5BC9A1' },
  flash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mute: { position: 'absolute', top: space.x5 + space.lg, right: space.sm, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  progressFill: { height: 2, backgroundColor: WHITE },
});
