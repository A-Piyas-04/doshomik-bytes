import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ApiError } from '@/api/client';
import { useLearnFirst, useMarkRead, usePaper, useToggleSave } from '@/api/research';
import { useComments } from '@/api/social';
import { compactNumber, useLang, useT } from '@/i18n';
import type { Lang } from '@/lib/prefs';
import { copyLink, openExternal, shareLink } from '@/lib/share';
import { useColors, useTheme } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { showActions } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { Tag } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { ArrowUpRight, BookmarkSimple, CaretRight, DotsThree, FileText, LinkGlyph, PaperPlaneTilt, Path, Notebook } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SegmentedTabs } from '@/ui/SegmentedTabs';
import { Bone, Pulse } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { go } from '@/shell/nav';
import { AreaGlyph, fieldName } from '../fields';
import { useArea, useWash } from '@/theme/area';
import { StatusBar } from 'expo-status-bar';
import { AddToTrailSheet } from './AddToTrailSheet';
import { DotMeter } from './DotMeter';
import { pickCard } from './paper-text';
import { ConnectionsTab, DiscussionTab, SummaryTab } from './PaperSections';
import { ReadingDots, STEP_LABEL } from './ReadingDots';
import { ReadingSheet } from './ReadingSheet';

type Tab = 'summary' | 'connections' | 'discussion';

/**
 * The paper: one scrolling page in layers. First what it is (meta, title, authors), then the
 * question it asks, then the one prominent secondary action, "Before you read". Below, three
 * in-page tabs keep the rest out of the way: Summary, Connections, Discussion. The bar at the
 * bottom holds the primary action (open the paper) and the reading tracker.
 */
export function PaperScreen({ id }: { id: string }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const paper = usePaper(id);
  const learnFirst = useLearnFirst(id);
  const area = useArea(paper.data?.field.slug);
  const wash = useWash();
  const { scheme } = useTheme();
  const heroBg = wash(area.solid);
  const discussion = useComments({ kind: 'papers', id });
  const toggleSave = useToggleSave();
  const markRead = useMarkRead(id);
  const [tab, setTab] = useState<Tab>('summary');
  const [cardLang, setCardLang] = useState<Lang | null>(null);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [showAllAuthors, setShowAllAuthors] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  const [trailOpen, setTrailOpen] = useState(false);
  const [titleInHeader, setTitleInHeader] = useState(false);

  const data = paper.data;
  const picked = useMemo(() => (data ? pickCard(data, cardLang ?? lang) : null), [data, cardLang, lang]);
  const tabs = useMemo(() => {
    const count = discussion.items.length;
    const discussionLabel = count && !discussion.hasNextPage ? t('paper.tabDiscussionCount', { n: count }) : t('paper.tabDiscussion');
    return [
      { value: 'summary' as const, label: t('paper.tabSummary') },
      { value: 'connections' as const, label: t('paper.tabConnections') },
      { value: 'discussion' as const, label: discussionLabel },
    ];
  }, [discussion.items.length, discussion.hasNextPage, t]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const past = event.nativeEvent.contentOffset.y > 120;
    if (past !== titleInHeader) setTitleInHeader(past);
  };

  if (paper.isPending) return <PaperSkeleton />;
  if (paper.isError || !data) {
    const missing = paper.error instanceof ApiError && paper.error.status === 404;
    return (
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        <ScreenHeader />
        {missing ? <EmptyState icon={FileText} message={t('post.unavailable')} /> : <ErrorState onRetry={() => void paper.refetch()} />}
      </View>
    );
  }

  const card = picked?.card ?? null;
  const both = !!data.cards.en && !!data.cards.bn;
  const extra = card?.extra_questions ?? [];
  const step = data.my_reading?.step ?? data.my_step;

  const openMenu = () =>
    showActions({
      actions: [
        { label: t('reading.title'), icon: Notebook, onPress: () => setReadingOpen(true) },
        { label: t('paper.addToTrail'), icon: Path, onPress: () => setTrailOpen(true) },
        { label: t('common.share'), icon: PaperPlaneTilt, onPress: () => void shareLink(data.share_url, data.title) },
        { label: t('common.copyLink'), icon: LinkGlyph, onPress: () => void copyLink(data.share_url) },
      ],
    });

  const links = [
    { label: t('paper.abstractPage'), url: data.links.open_url },
    data.links.pdf_url ? { label: t('paper.pdf'), url: data.links.pdf_url } : null,
    data.links.code_url ? { label: t('paper.code'), url: data.links.code_url } : null,
  ].filter((link): link is { label: string; url: string } => !!link);

  const metrics = [
    data.citation_count ? t('research.citations', { n: compactNumber(data.citation_count) }) : null,
    data.hf_upvotes ? t('research.upvotes', { n: compactNumber(data.hf_upvotes) }) : null,
    data.arxiv_id ? `arXiv ${data.arxiv_id}` : null,
  ].filter(Boolean);

  const lf = learnFirst.data;

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ScreenHeader
        tint={{ bg: heroBg, fg: colors.text }}
        title={titleInHeader ? data.title : ''}
        right={
          <>
            <IconButton
              icon={BookmarkSimple}
              weight={data.saved_by_me ? 'fill' : 'regular'}
              color={data.saved_by_me ? colors.accent : colors.text}
              label={data.saved_by_me ? t('research.unsave') : t('research.save')}
              selected={data.saved_by_me}
              onPress={() => toggleSave.mutate({ id, save: !data.saved_by_me })}
            />
            <IconButton icon={DotsThree} weight="bold" color={colors.text} label={t('paper.options')} onPress={openMenu} />
          </>
        }
      />
      <ScrollView stickyHeaderIndices={[1]} onScroll={onScroll} scrollEventThrottle={64} contentContainerStyle={{ paddingBottom: space.x4 }}>
        <View>
        <View style={[styles.hero, { backgroundColor: heroBg }]}>
          <View style={styles.metaLine}>
            <View style={[styles.areaPill, { borderColor: area.ink, backgroundColor: colors.surface }]}>
              <AreaGlyph slug={data.field.slug} size={13} weight="fill" color={area.ink} />
              <AppText variant="micro" tone="text">
                {fieldName(data.field, lang)}
              </AppText>
            </View>
            <AppText variant="meta" tone="textSecondary">
              {String(data.venue ?? data.year ?? '')}
            </AppText>
            {data.is_new ? <Tag label={t('common.new')} tone="highlight" /> : data.is_trending ? <Tag label={t('common.trending')} tone="highlight" /> : null}
          </View>
          <AppText variant="paperTitle" accessibilityRole="header">
            {data.title}
          </AppText>
          {data.authors ? (
            <Tap feedback="none" onPress={() => setShowAllAuthors((v) => !v)} accessibilityState={{ expanded: showAllAuthors }}>
              <AppText variant="caption" numberOfLines={showAllAuthors ? undefined : 2} tone="textSecondary">
                {data.authors}
              </AppText>
            </Tap>
          ) : null}
          {metrics.length ? (
            <AppText variant="caption" tone="textTertiary">
              {metrics.join(' · ')}
            </AppText>
          ) : null}
          <View style={styles.links}>
            {links.map((link, index) => (
              <Tap key={link.label} onPress={() => void openExternal(link.url)} style={styles.link} accessibilityRole="link" accessibilityHint={t('common.opensOutside')}>
                {index > 0 ? (
                  <AppText variant="label" tone="textTertiary">
                    {'·  '}
                  </AppText>
                ) : null}
                <AppText variant="label" weight="semibold" tone="text">
                  {link.label}
                </AppText>
                <ArrowUpRight size={12} color={colors.text} weight="bold" />
              </Tap>
            ))}
          </View>
        </View>
        <View style={styles.below}>

          {/* The question: what the paper sets out to answer. */}
          {card?.question ? (
            <View style={styles.question}>
              <View style={styles.questionHead}>
                <AppText variant="meta" tone="accent" style={styles.flex}>
                  {t('paper.question')}
                </AppText>
                {both ? (
                  <View style={[styles.langSwitch, { borderColor: colors.border }]} accessibilityRole="radiogroup" accessibilityLabel={t('paper.cardLang')}>
                    {(['en', 'bn'] as const).map((option) => {
                      const selected = picked?.lang === option;
                      return (
                        <Tap
                          key={option}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => setCardLang(option)}
                          style={[styles.langOption, selected ? { backgroundColor: colors.elevated } : null]}
                        >
                          <AppText variant="label" weight="semibold" tone={selected ? 'text' : 'textTertiary'}>
                            {option === 'en' ? 'EN' : 'বাং'}
                          </AppText>
                        </Tap>
                      );
                    })}
                  </View>
                ) : null}
              </View>
              <AppText variant="lead">{card.question}</AppText>
              {extra.length ? (
                showAllQuestions ? (
                  extra.map((q) => (
                    <AppText key={q} variant="body" tone="textSecondary">
                      {q}
                    </AppText>
                  ))
                ) : (
                  <Tap onPress={() => setShowAllQuestions(true)} hitSlop={8} style={styles.more}>
                    <AppText variant="label" tone="textTertiary">
                      {extra.length === 1 ? t('paper.moreQuestion') : t('paper.moreQuestions', { n: extra.length })}
                    </AppText>
                  </Tap>
                )
              ) : null}
              {!both && picked && picked.lang !== lang ? (
                <AppText variant="caption" tone="textTertiary">
                  {picked.lang === 'en' ? t('paper.onlyEnglish') : t('paper.onlyBangla')}
                </AppText>
              ) : null}
            </View>
          ) : null}

          {/* The one prominent secondary action: get ready to read. */}
          {lf && lf.total > 0 ? (
            <Tap feedback="fill" onPress={() => go.learnFirst(id)} style={[styles.ready, { borderColor: colors.border }]} accessibilityHint={t('lf.title')}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{t('paper.beforeRead')}</AppText>
                <View style={styles.readyMeter}>
                  <DotMeter filled={lf.ready} total={lf.total} />
                  <AppText variant="caption" tone={lf.ready === lf.total ? 'accent' : 'textSecondary'}>
                    {lf.ready === lf.total ? t('lf.ready') : t('paper.readyCount', { ready: lf.ready, total: lf.total })}
                  </AppText>
                </View>
              </View>
              <CaretRight size={18} color={colors.textTertiary} />
            </Tap>
          ) : null}
        </View>
        </View>

        <View style={{ backgroundColor: colors.surface }}>
          <SegmentedTabs options={tabs} value={tab} onChange={setTab} />
        </View>

        {tab === 'summary' ? <SummaryTab paper={data} card={card} /> : null}
        {tab === 'connections' ? <ConnectionsTab paperId={id} /> : null}
        {tab === 'discussion' ? <DiscussionTab paperId={id} /> : null}
      </ScrollView>

      <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: space.sm }]}>
        <Button label={t('paper.openPaper')} trailingIcon={ArrowUpRight} onPress={() => void openExternal(data.links.open_url)} style={styles.flex} accessibilityHint={t('common.opensOutside')} />
        {step > 0 ? (
          <Tap
            onPress={() => setReadingOpen(true)}
            style={[styles.tracker, { borderColor: colors.border, backgroundColor: colors.bg }]}
            accessibilityLabel={`${t('reading.title')}: ${t(STEP_LABEL[step as 1 | 2 | 3])}`}
          >
            <ReadingDots step={step} />
            <AppText variant="label" weight="semibold" tone="accent">
              {t(STEP_LABEL[step as 1 | 2 | 3])}
            </AppText>
          </Tap>
        ) : (
          <Tap onPress={() => markRead.mutate()} style={[styles.tracker, { borderColor: colors.border, backgroundColor: colors.bg }]} accessibilityLabel={t('paper.markRead')}>
            <ReadingDots step={0} />
            <AppText variant="label" weight="semibold">
              {t('paper.markRead')}
            </AppText>
          </Tap>
        )}
      </View>

      <ReadingSheet paperId={id} pass={data.my_reading} visible={readingOpen} onClose={() => setReadingOpen(false)} />
      <AddToTrailSheet paperId={id} visible={trailOpen} onClose={() => setTrailOpen(false)} />
    </View>
  );
}

function PaperSkeleton() {
  const colors = useColors();
  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <ScreenHeader />
      <Pulse style={styles.skeleton}>
        <Bone width="45%" height={10} />
        <Bone width="95%" height={26} />
        <Bone width="70%" height={26} />
        <Bone width="60%" height={12} />
        <Bone width="100%" height={18} style={styles.skeletonGap} />
        <Bone width="85%" height={18} />
        <Bone width="100%" height={64} style={styles.skeletonGap} />
      </Pulse>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  hero: { paddingHorizontal: layout.screenPadding, paddingTop: space.md, paddingBottom: space.lg, gap: space.sm },
  below: { paddingHorizontal: layout.screenPadding, paddingBottom: space.lg },
  areaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.xs, paddingHorizontal: 6, height: 22 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 36, paddingRight: space.sm },
  question: { gap: space.sm, paddingTop: space.xl },
  questionHead: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  langSwitch: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.sm, padding: 2 },
  langOption: { paddingHorizontal: space.md, height: 28, justifyContent: 'center', borderRadius: radius.xs },
  more: { alignSelf: 'flex-start' },
  ready: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.md, padding: space.lg, marginTop: space.lg },
  readyMeter: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  bar: { flexDirection: 'row', gap: space.sm, paddingHorizontal: layout.screenPadding, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  tracker: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 44, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1 },
  skeleton: { padding: layout.screenPadding, gap: space.md },
  skeletonGap: { marginTop: space.lg },
});
