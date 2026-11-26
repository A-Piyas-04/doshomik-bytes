import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Post } from '@/api/types';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useTextPostPaint } from '@/theme/area';
import { useColors } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Play, Quotes } from '@/ui/icons';
import { Tap } from '@/ui/Tap';
import { AreaGlyph } from '../fields';

/**
 * A post in a grid (Explore, profiles). Images and reel posters fill the tile. A text post is set
 * as black type on a soft wash of its area's colour (light grey when it has no topic), so a grid of
 * ideas is as bright as a grid of photos. Big tiles (the Explore mosaic) get bigger type.
 */
export const PostTile = memo(function PostTile({ post, size, height = size }: { post: Post; size: number; height?: number }) {
  const t = useT();
  const colors = useColors();
  const paint = useTextPostPaint(post.topic?.field);
  const big = size > 200;
  const thumb = post.type === 'reel' ? post.media?.thumbnail_url : (post.media?.thumbnail_url ?? post.media?.url);

  return (
    <Tap
      feedback="opacity"
      onPress={() => (post.type === 'reel' ? go.reel(post.id) : go.post(post.id))}
      accessibilityLabel={post.type === 'reel' ? t('post.playReel') : (post.caption ?? t('post.title'))}
      style={{ width: size, height, backgroundColor: post.type === 'text' ? paint.bg : colors.inverse, overflow: 'hidden' }}
    >
      {post.type === 'text' ? (
        <View style={[styles.text, big ? styles.textBig : null]}>
          {big ? <Quotes size={26} weight="fill" color={paint.fg} style={styles.quote} /> : null}
          <View style={styles.body}>
            <AppText variant={big ? 'lead' : 'label'} weight="medium" tone="text" numberOfLines={big ? 7 : height > size ? 7 : 4}>
              {post.caption ?? ''}
            </AppText>
          </View>
          {post.topic ? (
            <View style={styles.topic}>
              <AreaGlyph slug={post.topic.field} size={big ? 14 : 11} weight="fill" color={paint.fg} />
              <AppText variant="micro" weight="semibold" tone="text" numberOfLines={1} style={styles.flex}>
                {post.topic.name}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : thumb ? (
        <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={post.id} transition={100} />
      ) : null}
      {post.type === 'reel' ? (
        <View style={styles.reel}>
          <Play size={big ? 18 : 13} weight="fill" color="#FFFFFF" />
        </View>
      ) : null}
    </Tap>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, overflow: 'hidden' },
  text: { flex: 1, padding: space.sm, gap: space.xs },
  textBig: { padding: space.lg, gap: space.sm },
  quote: { opacity: 0.55 },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 4, opacity: 0.92 },
  reel: { position: 'absolute', top: space.sm, right: space.sm },
});
