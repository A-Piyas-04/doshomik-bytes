import { useScrollToTop } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CreateMenu } from '@/features/home/CreateMenu';
import { HomeHeader } from '@/features/home/HomeHeader';
import { ResearchHome, type ScrollableHandle } from '@/features/research/ResearchHome';
import { FeedPane } from '@/features/social/FeedPane';
import { useT } from '@/i18n';
import { usePrefs, type HomePane } from '@/lib/prefs';
import { useColors } from '@/theme/theme';
import { SegmentedTabs } from '@/ui/SegmentedTabs';

/**
 * Home: the header, then two sub-tabs under it, Feed and Research. Both panes stay mounted so
 * each keeps its scroll position; the last one used is remembered. Tapping the Home tab again
 * scrolls the visible pane to the top.
 */
export default function HomeScreen() {
  const t = useT();
  const colors = useColors();
  const pane = usePrefs((s) => s.homePane);
  const setPrefs = usePrefs((s) => s.set);
  const [creating, setCreating] = useState(false);
  const feedRef = useRef<ScrollableHandle>(null);
  const researchRef = useRef<ScrollableHandle>(null);
  const [researchMounted, setResearchMounted] = useState(pane === 'research');

  const paneRef = useRef(pane);
  useEffect(() => {
    paneRef.current = pane;
  }, [pane]);
  const proxy = useRef({ scrollToTop: () => (paneRef.current === 'feed' ? feedRef : researchRef).current?.scrollToTop() });
  useScrollToTop(proxy);

  const setPane = (next: HomePane) => {
    if (next === 'research') setResearchMounted(true);
    setPrefs({ homePane: next });
  };
  const options = useMemo(
    () => [
      { value: 'feed' as const, label: t('home.feed') },
      { value: 'research' as const, label: t('home.research') },
    ],
    [t],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <HomeHeader onCreate={() => setCreating(true)} />
      <SegmentedTabs options={options} value={pane} onChange={setPane} />
      <View style={[styles.pane, pane === 'feed' ? null : styles.hidden]}>
        <FeedPane ref={feedRef} onOpenResearch={() => setPane('research')} />
      </View>
      {researchMounted ? (
        <View style={[styles.pane, pane === 'research' ? null : styles.hidden]}>
          <ResearchHome ref={researchRef} active={pane === 'research'} />
        </View>
      ) : null}
      <CreateMenu visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pane: { flex: 1 },
  hidden: { display: 'none' },
});
