import { noOutline } from '@/ui/noOutline';
import { FlashList } from '@shopify/flash-list';
import { useScrollToTop } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSearch, useSuggest } from '@/api/learn';
import { useToggleSave } from '@/api/research';
import { useExplore } from '@/api/social';
import type { Post, SearchResults, SearchType } from '@/api/types';
import { useT } from '@/i18n';
import { usePrefs } from '@/lib/prefs';
import { hasBengali } from '@/lib/script';
import { openExternal } from '@/lib/share';
import { go } from '@/shell/nav';
import { fontFamily } from '@/theme/fonts';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Divider, ListFooter, SectionLabel } from '@/ui/Bits';
import { IconButton } from '@/ui/IconButton';
import { BookOpen, FileText, GraduationCap, MagnifyingGlass, UserCircle, X, type IconComponent } from '@/ui/icons';
import { SegmentedTabs } from '@/ui/SegmentedTabs';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { ALL, FieldChips } from '../fields';
import { LessonRow } from '../learn/LearnHome';
import { PaperRow } from '../research/PaperRow';
import { PostTile } from './PostTile';

type ResultTab = 'top' | 'papers' | 'learn' | 'people' | 'posts';
const GAP = 2;

/**
 * Explore: one search box for everything (people, papers, lessons, courses, topics, posts), and,
 * while not searching, a grid of what people are posting, filtered by learn area.
 */
export function ExploreScreen() {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const remember = usePrefs((s) => s.rememberSearch);
  const recent = usePrefs((s) => s.recentSearches);
  const forget = usePrefs((s) => s.forgetSearches);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [submitted, setSubmitted] = useState('');
  const [tab, setTab] = useState<ResultTab>('top');
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const debounced = useDebounced(text.trim(), 250);
  const suggest = useSuggest(focused && !submitted ? debounced : '');

  const submit = (value = text) => {
    const q = value.trim();
    if (!q) return;
    setText(q);
    setSubmitted(q);
    setTab('top');
    remember('recentSearches', q);
    Keyboard.dismiss();
  };
  const clear = () => {
    setText('');
    setSubmitted('');
    input.current?.blur();
  };

  const searching = focused && !submitted;
  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.searchBar}>
        <View style={[styles.field, { backgroundColor: colors.surface, borderColor: focused ? colors.accent : colors.border }]}>
          <MagnifyingGlass size={18} color={colors.textTertiary} />
          <TextInput
            ref={input}
            value={text}
            onChangeText={(value) => {
              setText(value);
              if (submitted) setSubmitted('');
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => submit()}
            returnKeyType="search"
            placeholder={t('explore.search')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            accessibilityLabel={t('explore.search')}
            style={[noOutline, styles.input, { color: colors.text, fontFamily: fontFamily('sans', 'regular', hasBengali(text) ? 'bengali' : 'latin') }]}
          />
          {text ? <IconButton icon={X} size={18} label={t('common.clear')} onPress={clear} /> : null}
        </View>
      </View>

      {submitted ? (
        <Results q={submitted} tab={tab} onTab={setTab} />
      ) : searching ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          {debounced.length >= 2 && suggest.data?.length ? (
            <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {suggest.data.map((item, index) => (
                <View key={`${item.type}-${item.id}`}>
                  {index > 0 ? <Divider inset={layout.screenPadding + 34} /> : null}
                  <SuggestionRow
                    icon={item.type === 'paper' ? FileText : item.type === 'course' ? GraduationCap : item.type === 'user' ? UserCircle : BookOpen}
                    label={item.label}
                    onPress={() => {
                      remember('recentSearches', item.label);
                      if (item.type === 'paper') go.paper(item.id);
                      else if (item.type === 'course') go.course(item.id);
                      else if (item.type === 'user') go.user(item.id);
                      else go.topic(item.id);
                    }}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {!text && recent.length ? (
            <>
              <SectionLabel label={t('explore.recent')} action={t('common.clear')} onAction={() => forget('recentSearches')} />
              {recent.map((item) => (
                <SuggestionRow key={item} icon={MagnifyingGlass} label={item} onPress={() => submit(item)} />
              ))}
            </>
          ) : null}
        </ScrollView>
      ) : (
        <ExploreGrid />
      )}
    </View>
  );
}

function SuggestionRow({ icon: Icon, label, onPress }: { icon: IconComponent; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Tap feedback="fill" onPress={onPress} style={styles.suggestion}>
      <Icon size={18} color={colors.textTertiary} />
      <AppText variant="body" numberOfLines={1} style={styles.flex}>
        {label}
      </AppText>
    </Tap>
  );
}

function ExploreGrid() {
  const t = useT();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const [area, setArea] = useState(ALL);
  const explore = useExplore(area === ALL ? undefined : area);
  const size = Math.min(width, 720) / 3 - GAP;
  const list = useRef(null);
  useScrollToTop(list);
  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <View style={styles.cell}>
        <PostTile post={item} size={size} />
      </View>
    ),
    [size],
  );
  return (
    <FlashList
      ref={list}
      data={explore.items}
      numColumns={3}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<FieldChips value={area} onChange={setArea} style={styles.chips} />}
      ItemSeparatorComponent={GridGap}
      ListEmptyComponent={
        explore.isPending ? <RowsSkeleton rows={3} /> : explore.isError ? <ErrorState onRetry={() => void explore.refetch()} /> : <EmptyState icon={MagnifyingGlass} message={t('explore.empty')} />
      }
      onEndReached={explore.loadMore}
      onEndReachedThreshold={1.5}
      ListFooterComponent={<ListFooter loading={explore.isFetchingNextPage} />}
      refreshControl={<RefreshControl refreshing={explore.isRefetching && !explore.isFetchingNextPage} onRefresh={() => void explore.refetch()} tintColor={colors.accent} />}
      contentContainerStyle={styles.gridContent}
    />
  );
}

function GridGap() {
  return <View style={{ height: GAP }} />;
}

/** Search results: Top shows a few of each kind; the other tabs show one kind in full. */
function Results({ q, tab, onTab }: { q: string; tab: ResultTab; onTab: (tab: ResultTab) => void }) {
  const t = useT();
  const options = useMemo(
    () => [
      { value: 'top' as const, label: t('explore.tabTop') },
      { value: 'papers' as const, label: t('explore.tabPapers') },
      { value: 'learn' as const, label: t('explore.tabLearn') },
      { value: 'people' as const, label: t('explore.tabPeople') },
      { value: 'posts' as const, label: t('explore.tabPosts') },
    ],
    [t],
  );
  return (
    <View style={styles.flex}>
      <SegmentedTabs options={options} value={tab} onChange={onTab} stretch={false} />
      {tab === 'top' ? <TopResults q={q} onTab={onTab} /> : null}
      {tab === 'papers' ? <TypedResults q={q} types={['papers']} /> : null}
      {tab === 'learn' ? <TypedResults q={q} types={['topics', 'learn_items', 'courses']} /> : null}
      {tab === 'people' ? <TypedResults q={q} types={['users']} /> : null}
      {tab === 'posts' ? <TypedResults q={q} types={['posts']} /> : null}
    </View>
  );
}

function TopResults({ q, onTab }: { q: string; onTab: (tab: ResultTab) => void }) {
  const t = useT();
  const search = useSearch(q);
  if (search.isPending) return <RowsSkeleton rows={4} />;
  if (search.isError) return <ErrorState onRetry={() => void search.refetch()} />;
  const r = search.data ?? {};
  const empty = !r.papers?.length && !r.users?.length && !r.posts?.length && !r.topics?.length && !r.learn_items?.length && !r.courses?.length;
  if (empty) return <EmptyState icon={MagnifyingGlass} message={t('explore.noResults', { q })} />;
  return (
    <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
      <ResultSections results={r} limit={3} onSeeAll={onTab} />
    </ScrollView>
  );
}

function TypedResults({ q, types }: { q: string; types: SearchType[] }) {
  const t = useT();
  const a = useSearch(q, types[0]);
  const b = useSearch(types[1] ? q : '', types[1]);
  const c = useSearch(types[2] ? q : '', types[2]);
  const queries = [a, b, c].slice(0, types.length);
  if (queries.some((x) => x.isPending)) return <RowsSkeleton rows={4} />;
  if (queries.some((x) => x.isError)) return <ErrorState onRetry={() => queries.forEach((x) => void x.refetch())} />;
  const merged: SearchResults = Object.assign({}, ...queries.map((x) => x.data ?? {}));
  const count = types.reduce((n, type) => n + (merged[type]?.length ?? 0), 0);
  if (!count) return <EmptyState icon={MagnifyingGlass} message={t('explore.noResults', { q })} />;
  return (
    <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
      <ResultSections results={merged} />
    </ScrollView>
  );
}

const TAB_OF: Partial<Record<SearchType, ResultTab>> = { papers: 'papers', users: 'people', posts: 'posts', topics: 'learn', learn_items: 'learn', courses: 'learn' };

function ResultSections({ results, limit, onSeeAll }: { results: SearchResults; limit?: number; onSeeAll?: (tab: ResultTab) => void }) {
  const t = useT();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const toggleSave = useToggleSave();
  const cut = <T,>(items: T[] | undefined) => (limit ? (items ?? []).slice(0, limit) : (items ?? []));
  const seeAll = (type: SearchType) => (limit && onSeeAll && (results[type]?.length ?? 0) > limit ? () => onSeeAll(TAB_OF[type]!) : undefined);
  const surface = [styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }];
  const tile = (Math.min(width, 720) - GAP * 2) / 3;

  return (
    <>
      {results.papers?.length ? (
        <>
          <SectionLabel label={t('explore.papers')} action={seeAll('papers') ? t('common.seeAll') : undefined} onAction={seeAll('papers')} />
          <View style={surface}>
            {cut(results.papers).map((paper, i) => (
              <View key={paper.id}>
                {i > 0 ? <Divider /> : null}
                <PaperRow paper={paper} onOpen={go.paper} onToggleSave={(id, save) => toggleSave.mutate({ id, save })} />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {results.topics?.length ? (
        <>
          <SectionLabel label={t('explore.topics')} action={seeAll('topics') ? t('common.seeAll') : undefined} onAction={seeAll('topics')} />
          <View style={surface}>
            {cut(results.topics).map((topic, i) => (
              <View key={topic.slug}>
                {i > 0 ? <Divider /> : null}
                <Tap feedback="fill" onPress={() => go.topic(topic.slug)} style={styles.row}>
                  <AppText variant="bodyStrong">{topic.name}</AppText>
                  {topic.summary ? (
                    <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
                      {topic.summary}
                    </AppText>
                  ) : null}
                </Tap>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {results.learn_items?.length ? (
        <>
          <SectionLabel label={t('explore.lessons')} action={seeAll('learn_items') ? t('common.seeAll') : undefined} onAction={seeAll('learn_items')} />
          <View style={surface}>
            {cut(results.learn_items).map((item, i) => (
              <View key={item.id}>
                {i > 0 ? <Divider inset={layout.screenPadding + 36} /> : null}
                <LessonRow item={{ ...item, duration_seconds: null }} />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {results.courses?.length ? (
        <>
          <SectionLabel label={t('explore.courses')} action={seeAll('courses') ? t('common.seeAll') : undefined} onAction={seeAll('courses')} />
          <View style={surface}>
            {cut(results.courses).map((course, i) => (
              <View key={course.id}>
                {i > 0 ? <Divider /> : null}
                <Tap feedback="fill" onPress={() => (course.external_url ? void openExternal(course.external_url) : go.course(course.id))} style={styles.row}>
                  <AppText variant="bodyStrong">{course.title}</AppText>
                  {course.description ? (
                    <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
                      {course.description}
                    </AppText>
                  ) : null}
                </Tap>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {results.users?.length ? (
        <>
          <SectionLabel label={t('explore.people')} action={seeAll('users') ? t('common.seeAll') : undefined} onAction={seeAll('users')} />
          <View style={surface}>
            {cut(results.users).map((user, i) => (
              <View key={user.id}>
                {i > 0 ? <Divider inset={layout.screenPadding + 52} /> : null}
                <Tap feedback="fill" onPress={() => go.user(user.id)} style={styles.person}>
                  <Avatar url={user.avatar_url} name={user.display_name ?? user.username} size={40} />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{user.username}</AppText>
                    {user.display_name ? (
                      <AppText variant="caption" tone="textSecondary">
                        {user.display_name}
                      </AppText>
                    ) : null}
                  </View>
                </Tap>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {results.posts?.length ? (
        <>
          <SectionLabel label={t('explore.posts')} action={seeAll('posts') ? t('common.seeAll') : undefined} onAction={seeAll('posts')} />
          <View style={styles.tiles}>
            {cut(results.posts).map((post) => (
              <PostTile key={post.id} post={post} size={tile} />
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [state, setState] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setState(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return state;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  searchBar: { paddingHorizontal: layout.screenPadding, paddingVertical: space.sm },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 44, borderRadius: radius.sm, borderWidth: 1, paddingLeft: space.md },
  input: { flex: 1, fontSize: 15, height: 44, paddingVertical: 0 },
  chips: { flexGrow: 0, paddingBottom: space.sm },
  gridContent: { paddingBottom: space.x4 },
  surface: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, minHeight: 48 },
  results: { paddingBottom: space.x5 },
  row: { paddingHorizontal: layout.screenPadding, paddingVertical: space.md, gap: 2 },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  cell: { paddingHorizontal: GAP / 2 },
});
