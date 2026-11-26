import { noOutline } from '@/ui/noOutline';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams, useScrollToTop } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCourses, useSearch, useSuggest } from '@/api/learn';
import { useFields, usePapers, useToggleSave } from '@/api/research';
import { useExplore } from '@/api/social';
import type { Post, SearchResults, SearchType } from '@/api/types';
import { useLang, useT } from '@/i18n';
import { usePrefs } from '@/lib/prefs';
import { hasBengali } from '@/lib/script';
import { openExternal } from '@/lib/share';
import { go } from '@/shell/nav';
import { useArea, useWash } from '@/theme/area';
import { fontFamily } from '@/theme/fonts';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Divider, ListFooter, SectionLabel, SectionTitle } from '@/ui/Bits';
import { IconButton } from '@/ui/IconButton';
import { BookOpen, Exam, FileText, Fire, GraduationCap, MagnifyingGlass, MapTrifold, SquaresFour, UserCircle, X, type IconComponent } from '@/ui/icons';
import { SegmentedTabs } from '@/ui/SegmentedTabs';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { ALL, AreaGlyph, FieldChips, fieldName } from '../fields';
import { CourseCard } from '../learn/CourseCard';
import { LessonRow } from '../learn/LearnHome';
import { PaperRow } from '../research/PaperRow';
import { PostTile } from './PostTile';

type ResultTab = 'top' | 'papers' | 'learn' | 'people' | 'posts';
const GAP = 2;

/**
 * Explore: one search box for everything (people, papers, lessons, courses, topics, posts), and,
 * while not searching, the discovery page: the areas, what is trending in research, courses, then
 * a mosaic of what people post, all following the chosen area.
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
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={[styles.field, { backgroundColor: colors.elevated, borderColor: focused ? colors.accent : 'transparent' }]}>
          <MagnifyingGlass size={18} weight="bold" color={colors.textSecondary} />
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
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
        <Discover />
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

type BlockKind = 'row' | 'bigLeft' | 'bigRight';
interface Block {
  key: string;
  kind: BlockKind;
  posts: Post[];
}
const PATTERN: BlockKind[] = ['bigLeft', 'row', 'bigRight', 'row'];

/**
 * The posts as a mosaic: blocks of three, every other block led by one big tile (a reel first,
 * then an image, then the first post), alternating sides. Pages are 30 posts, so a new page never
 * reshuffles the blocks already on screen.
 */
function toBlocks(posts: Post[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0, n = 0; i < posts.length; i += 3, n += 1) {
    const chunk = posts.slice(i, i + 3);
    const kind = chunk.length < 3 ? 'row' : PATTERN[n % PATTERN.length]!;
    if (kind !== 'row') {
      const reel = chunk.findIndex((p) => p.type === 'reel');
      const image = chunk.findIndex((p) => p.type === 'image');
      const lead = reel >= 0 ? reel : image >= 0 ? image : 0;
      chunk.unshift(chunk.splice(lead, 1)[0]!);
    }
    blocks.push({ key: chunk.map((p) => p.id).join(':'), kind, posts: chunk });
  }
  return blocks;
}

/** The discovery page. The area comes from the URL (the feed's area circles link here with one). */
function Discover() {
  const t = useT();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ area?: string }>();
  const area = params.area || ALL;
  const field = area === ALL ? undefined : area;
  const setArea = (value: string) => router.setParams({ area: value === ALL ? '' : value });
  const explore = useExplore(field);
  const blocks = useMemo(() => toBlocks(explore.items), [explore.items]);
  const small = (Math.min(width, 720) - GAP * 2) / 3;
  const list = useRef(null);
  useScrollToTop(list);

  const renderItem = useCallback(({ item }: { item: Block }) => <MosaicBlock block={item} small={small} />, [small]);
  return (
    <FlashList
      ref={list}
      data={blocks}
      renderItem={renderItem}
      keyExtractor={(item) => item.key}
      getItemType={(item) => item.kind}
      ListHeaderComponent={
        <View>
          <View style={[styles.chipBand, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <FieldChips value={area} onChange={setArea} style={styles.chips} />
          </View>
          {field ? <AreaSpotlight slug={field} /> : null}
          <TrendingPapers field={field} />
          <CourseRail field={field} />
          <SectionTitle icon={SquaresFour} color={colors.text} title={t('explore.fromPeople')} />
        </View>
      }
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

function MosaicBlock({ block, small }: { block: Block; small: number }) {
  const big = small * 2 + GAP;
  const [a, b, c] = block.posts;
  if (block.kind === 'row' || !a || !b || !c) {
    return (
      <View style={styles.mosaicRow}>
        {block.posts.map((post) => (
          <PostTile key={post.id} post={post} size={small} />
        ))}
      </View>
    );
  }
  const stack = (
    <View style={styles.stack}>
      <PostTile post={b} size={small} />
      <PostTile post={c} size={small} />
    </View>
  );
  return (
    <View style={styles.mosaicRow}>
      {block.kind === 'bigRight' ? stack : null}
      <PostTile post={a} size={big} />
      {block.kind === 'bigLeft' ? stack : null}
    </View>
  );
}

function GridGap() {
  return <View style={{ height: GAP }} />;
}

/** A chosen area, in its colour: what it is, and the two ways in (its roadmap, practice). */
function AreaSpotlight({ slug }: { slug: string }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const wash = useWash();
  const fields = useFields();
  const area = useArea(slug);
  const info = fields.data?.find((f) => f.slug === slug);
  if (!info) return null;
  return (
    <View style={[styles.spotlight, { backgroundColor: wash(area.solid) }]}>
      <AreaGlyph slug={slug} size={120} weight="fill" color={area.solid} style={styles.spotGlyph} />
      <AppText variant="display">{fieldName(info, lang)}</AppText>
      {info.description ? (
        <AppText variant="body" tone="textSecondary" numberOfLines={3} style={styles.spotText}>
          {info.description}
        </AppText>
      ) : null}
      <View style={styles.spotActions}>
        <SpotAction icon={MapTrifold} label={t('explore.roadmap')} fill={colors.surface} ink={area.ink} onPress={() => go.roadmaps(slug)} />
        <SpotAction icon={Exam} label={t('learn.practice')} fill={colors.surface} ink={area.ink} onPress={() => go.practiceSession({ field: slug })} />
      </View>
    </View>
  );
}

function SpotAction({ icon: Icon, label, fill, ink, onPress }: { icon: IconComponent; label: string; fill: string; ink: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={[styles.spotAction, { backgroundColor: fill }]} accessibilityLabel={label}>
      <Icon size={16} weight="bold" color={ink} />
      <AppText variant="label" weight="semibold" tone="text">
        {label}
      </AppText>
    </Tap>
  );
}

function TrendingPapers({ field }: { field?: string }) {
  const t = useT();
  const colors = useColors();
  const papers = usePapers({ field, sort: 'trend' });
  const toggleSave = useToggleSave();
  const onSave = useCallback((id: string, save: boolean) => toggleSave.mutate({ id, save }), [toggleSave]);
  if (!papers.items.length) return null;
  return (
    <View>
      <SectionTitle icon={Fire} color={colors.highlight} title={t('explore.trendingPapers')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {papers.items.slice(0, 8).map((paper) => (
          <PaperRow key={paper.id} paper={paper} width={286} onOpen={go.paper} onToggleSave={onSave} />
        ))}
      </ScrollView>
    </View>
  );
}

function CourseRail({ field }: { field?: string }) {
  const t = useT();
  const colors = useColors();
  const courses = useCourses(field);
  if (!courses.items.length) return null;
  return (
    <View>
      <SectionTitle icon={GraduationCap} color={colors.accent} title={t('explore.learnSomething')} onPress={() => router.navigate('/learn')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {courses.items.slice(0, 10).map((course) => (
          <CourseCard key={course.id} course={course} width={200} />
        ))}
      </ScrollView>
    </View>
  );
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
  const group = [styles.group, { backgroundColor: colors.surface, borderColor: colors.border }];
  const tile = (Math.min(width, 720) - GAP * 2) / 3;

  return (
    <>
      {results.papers?.length ? (
        <>
          <SectionLabel label={t('explore.papers')} action={seeAll('papers') ? t('common.seeAll') : undefined} onAction={seeAll('papers')} />
          <View style={styles.cards}>
            {cut(results.papers).map((paper) => (
              <PaperRow key={paper.id} paper={paper} onOpen={go.paper} onToggleSave={(id, save) => toggleSave.mutate({ id, save })} />
            ))}
          </View>
        </>
      ) : null}
      {results.topics?.length ? (
        <>
          <SectionLabel label={t('explore.topics')} action={seeAll('topics') ? t('common.seeAll') : undefined} onAction={seeAll('topics')} />
          <View style={group}>
            {cut(results.topics).map((topic, i) => (
              <View key={topic.slug}>
                {i > 0 ? <Divider inset={layout.screenPadding + 50} /> : null}
                <IconRow icon={BookOpen} title={topic.name} subtitle={topic.summary} onPress={() => go.topic(topic.slug)} />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {results.learn_items?.length ? (
        <>
          <SectionLabel label={t('explore.lessons')} action={seeAll('learn_items') ? t('common.seeAll') : undefined} onAction={seeAll('learn_items')} />
          <View style={group}>
            {cut(results.learn_items).map((item, i) => (
              <View key={item.id}>
                {i > 0 ? <Divider inset={layout.screenPadding + 50} /> : null}
                <LessonRow item={{ ...item, duration_seconds: null }} />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {results.courses?.length ? (
        <>
          <SectionLabel label={t('explore.courses')} action={seeAll('courses') ? t('common.seeAll') : undefined} onAction={seeAll('courses')} />
          <View style={group}>
            {cut(results.courses).map((course, i) => (
              <View key={course.id}>
                {i > 0 ? <Divider inset={layout.screenPadding + 50} /> : null}
                <IconRow
                  icon={GraduationCap}
                  title={course.title}
                  subtitle={course.description}
                  onPress={() => (course.external_url ? void openExternal(course.external_url) : go.course(course.id))}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {results.users?.length ? (
        <>
          <SectionLabel label={t('explore.people')} action={seeAll('users') ? t('common.seeAll') : undefined} onAction={seeAll('users')} />
          <View style={group}>
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

/** A topic or course result: its glyph on the accent wash, the name, one line on what it is. */
function IconRow({ icon: Icon, title, subtitle, onPress }: { icon: IconComponent; title: string; subtitle: string | null; onPress: () => void }) {
  const colors = useColors();
  return (
    <Tap feedback="fill" onPress={onPress} style={styles.iconRow}>
      <View style={[styles.iconTile, { backgroundColor: colors.accentWash }]}>
        <Icon size={20} weight="fill" color={colors.accent} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </Tap>
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
  searchBar: { paddingHorizontal: layout.screenPadding, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 42, borderRadius: radius.sm, borderWidth: 1.5, paddingLeft: space.md },
  input: { flex: 1, fontSize: 15, height: 40, paddingVertical: 0 },
  chipBand: { borderBottomWidth: StyleSheet.hairlineWidth },
  chips: { flexGrow: 0, paddingVertical: space.sm },
  gridContent: { paddingBottom: space.x4 },
  spotlight: { marginHorizontal: space.md, marginTop: space.md, borderRadius: radius.lg, padding: space.lg, gap: space.sm, overflow: 'hidden', minHeight: 168 },
  spotGlyph: { position: 'absolute', right: -18, bottom: -22, opacity: 0.28 },
  spotText: { maxWidth: '82%' },
  spotActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  spotAction: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: space.md, borderRadius: radius.sm },
  rail: { paddingHorizontal: space.md, gap: space.md },
  mosaicRow: { flexDirection: 'row', gap: GAP },
  stack: { gap: GAP },
  group: { marginHorizontal: space.md, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  cards: { gap: space.sm },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, minHeight: 48 },
  results: { paddingBottom: space.x5 },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  iconTile: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
});
