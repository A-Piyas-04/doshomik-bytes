import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePost, useReels } from '@/api/social';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { CaretLeft, FilmSlate, Plus } from '@/ui/icons';
import { ReelPager } from './ReelPager';

const WHITE = '#FFFFFF';

/** The Reels tab: every visible reel, newest first, full height above the tab bar. */
export function ReelsTab() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const reels = useReels();
  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]} pointerEvents="box-none">
      <AppText variant="title" style={styles.white}>
        {t('tab.reels')}
      </AppText>
      <IconButton icon={Plus} weight="bold" color={WHITE} label={t('reels.create')} onPress={() => go.create('reel')} />
    </View>
  );

  if (reels.isPending) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={WHITE} />
        {header}
      </View>
    );
  }
  if (!reels.items.length) {
    return (
      <View style={[styles.root, styles.center]}>
        <FilmSlate size={36} color="rgba(255,255,255,0.6)" />
        <AppText variant="body" style={[styles.white, styles.emptyText]} align="center">
          {reels.isError ? t('common.errorTitle') : t('reels.empty')}
        </AppText>
        {reels.isError ? <Button label={t('common.retry')} kind="secondary" size="sm" onPress={() => void reels.refetch()} /> : <Button label={t('reels.create')} size="sm" onPress={() => go.create('reel')} />}
        {header}
      </View>
    );
  }
  return <ReelPager posts={reels.items} onEndReached={reels.loadMore} header={header} />;
}

/** One reel, full screen, opened from a post, Explore or Learn first. */
export function ReelViewer({ id }: { id: string }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const post = usePost(id);
  const back = (
    <View style={[styles.header, { paddingTop: insets.top }]} pointerEvents="box-none">
      <IconButton icon={CaretLeft} color={WHITE} label={t('a11y.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </View>
  );
  if (!post.data) {
    return (
      <View style={[styles.root, styles.center]}>
        {post.isError ? (
          <AppText variant="body" style={styles.white}>
            {t('post.unavailable')}
          </AppText>
        ) : (
          <ActivityIndicator color={WHITE} />
        )}
        {back}
      </View>
    );
  }
  return <ReelPager posts={[post.data]} header={back} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: layout.screenPadding, paddingRight: space.xs, minHeight: 52 },
  white: { color: WHITE },
  emptyText: { maxWidth: 260 },
});
