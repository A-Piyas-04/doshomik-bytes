import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Post } from '@/api/types';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Play } from '@/ui/icons';
import { Tap } from '@/ui/Tap';

/**
 * A post in a grid (Explore, profiles): images and reel posters fill the square; text posts are
 * set as type on the surface, so a grid of ideas still reads as a grid.
 */
export const PostTile = memo(function PostTile({ post, size }: { post: Post; size: number }) {
  const t = useT();
  const colors = useColors();
  const thumb = post.type === 'reel' ? post.media?.thumbnail_url : (post.media?.thumbnail_url ?? post.media?.url);
  return (
    <Tap
      feedback="opacity"
      onPress={() => (post.type === 'reel' ? go.reel(post.id) : go.post(post.id))}
      accessibilityLabel={post.type === 'reel' ? t('post.playReel') : (post.caption ?? t('post.title'))}
      style={{ width: size, height: size, backgroundColor: colors.surface }}
    >
      {post.type === 'text' ? (
        <View style={styles.text}>
          <AppText variant="caption" numberOfLines={5} style={styles.flex}>
            {post.caption ?? ''}
          </AppText>
          {post.topic ? (
            <AppText variant="micro" tone="accent" numberOfLines={1}>
              {post.topic.name}
            </AppText>
          ) : null}
        </View>
      ) : thumb ? (
        <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={post.id} transition={100} />
      ) : null}
      {post.type === 'reel' ? (
        <View style={styles.reel}>
          <Play size={14} weight="fill" color="#FFFFFF" />
        </View>
      ) : null}
    </Tap>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  text: { flex: 1, padding: space.sm, gap: space.xs },
  reel: { position: 'absolute', top: space.xs + 2, right: space.xs + 2 },
});
