import { ScrollView, StyleSheet, View } from 'react-native';
import { useKnowTopic, useLearnFirst, usePaper } from '@/api/research';
import type { Prerequisite } from '@/api/types';
import { useT } from '@/i18n';
import { openExternal } from '@/lib/share';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Divider } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { ArrowUpRight, Article, CheckCircle, Circle, Exam, FilmSlate, PlayCircle, Sparkle, type IconComponent } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { DotMeter } from './DotMeter';

const LINK_ICON: Record<string, IconComponent> = { lesson: PlayCircle, note: Article, quiz: Exam, reel: FilmSlate };

/**
 * Before you read: the paper's prerequisite concepts in order. Each says why it matters and links
 * to one thing to do (a lesson, a note, a quiz or a reel). Done is computed by the server; "I
 * already know this" counts too. Coming back here after a lesson refreshes the meter.
 */
export function LearnFirstScreen({ id }: { id: string }) {
  const t = useT();
  const colors = useColors();
  const paper = usePaper(id);
  const data = useLearnFirst(id);
  const know = useKnowTopic();

  const body = () => {
    if (data.isPending) return <RowsSkeleton rows={4} />;
    if (data.isError || !data.data) return <ErrorState onRetry={() => void data.refetch()} />;
    const lf = data.data;
    if (lf.total === 0) {
      return (
        <AppText variant="body" tone="textSecondary" style={styles.pad}>
          {t('lf.empty')}
        </AppText>
      );
    }
    return (
      <>
        <View style={styles.summary}>
          <DotMeter filled={lf.ready} total={lf.total} size={10} />
          <AppText variant="bodyStrong" tone={lf.ready === lf.total ? 'accent' : 'text'}>
            {lf.ready === lf.total ? t('lf.ready') : t('paper.readyCount', { ready: lf.ready, total: lf.total })}
          </AppText>
          <AppText variant="caption" tone="textSecondary">
            {t('lf.coverage', { n: lf.topics.filter((topic) => topic.link).length, total: lf.total })}
          </AppText>
        </View>
        <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {lf.topics.map((topic, index) => (
            <View key={topic.slug}>
              {index > 0 ? <Divider inset={layout.screenPadding + 36} /> : null}
              <ConceptRow index={index} topic={topic} onKnow={(known) => know.mutate({ slug: topic.slug, known })} />
            </View>
          ))}
        </View>
        {lf.ai_suggested ? (
          <View style={styles.aiNote}>
            <Sparkle size={14} color={colors.textTertiary} />
            <AppText variant="caption" tone="textTertiary" style={styles.flex}>
              {t('lf.aiNote')}
            </AppText>
          </View>
        ) : null}
      </>
    );
  };

  const ready = data.data && data.data.total > 0 && data.data.ready === data.data.total;
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('lf.title')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {paper.data ? (
          <View style={styles.paper}>
            <AppText variant="meta" tone="textTertiary">
              {t('lf.title')}
            </AppText>
            <AppText variant="paperRow" numberOfLines={3}>
              {paper.data.title}
            </AppText>
          </View>
        ) : null}
        {body()}
      </ScrollView>
      {paper.data ? (
        <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Button
            label={ready ? `${t('lf.ready')} · ${t('paper.openPaper')}` : t('paper.openPaper')}
            kind={ready ? 'primary' : 'secondary'}
            trailingIcon={ArrowUpRight}
            block
            onPress={() => void openExternal(paper.data!.links.open_url)}
          />
        </View>
      ) : null}
    </View>
  );
}

function ConceptRow({ index, topic, onKnow }: { index: number; topic: Prerequisite; onKnow: (known: boolean) => void }) {
  const t = useT();
  const colors = useColors();
  const link = topic.link;
  const LinkIcon = link ? LINK_ICON[link.kind] : null;
  const linkLabel = link
    ? link.kind === 'lesson'
      ? t('lf.lesson', { n: link.minutes ?? 1 })
      : link.kind === 'note'
        ? t('lf.note', { n: link.minutes ?? 1 })
        : link.kind === 'quiz'
          ? t('lf.quiz', { n: link.question_count ?? 0 })
          : t('lf.reel', { n: link.seconds ?? 0 })
    : null;
  const openLink = () => {
    if (!link) return;
    if (link.kind === 'lesson' || link.kind === 'note') go.lesson(link.id);
    else if (link.kind === 'quiz') go.practiceSession({ quiz: link.id });
    else go.reel(link.id);
  };

  return (
    <View style={styles.concept}>
      <View style={styles.state}>
        {topic.done ? <CheckCircle size={22} weight="fill" color={colors.accent} /> : <Circle size={22} color={colors.textTertiary} />}
      </View>
      <View style={styles.flex}>
        <AppText variant="meta" tone="textTertiary">
          {String(index + 1).padStart(2, '0')}
        </AppText>
        <AppText variant="bodyStrong">{topic.label}</AppText>
        {topic.why ? (
          <AppText variant="body" tone="textSecondary">
            {topic.why}
          </AppText>
        ) : null}
        {!link && topic.summary ? (
          <AppText variant="caption" tone="textTertiary">
            {topic.summary}
          </AppText>
        ) : null}
        <View style={styles.actions}>
          {link && LinkIcon ? (
            <Tap onPress={openLink} style={[styles.link, { borderColor: colors.border, backgroundColor: colors.bg }]} accessibilityLabel={`${linkLabel}: ${link.title ?? topic.label}`}>
              <LinkIcon size={18} color={colors.accent} weight="fill" />
              <AppText variant="label" weight="semibold" tone="accent">
                {linkLabel}
              </AppText>
            </Tap>
          ) : (
            <AppText variant="caption" tone="textTertiary">
              {t('lf.noLink')}
            </AppText>
          )}
          {topic.known ? (
            <Tap onPress={() => onKnow(false)} hitSlop={8} style={styles.know}>
              <AppText variant="label" tone="textSecondary">
                {`${t('lf.known')} · `}
                <AppText variant="label" tone="accent">
                  {t('lf.undo')}
                </AppText>
              </AppText>
            </Tap>
          ) : !topic.done ? (
            <Tap onPress={() => onKnow(true)} hitSlop={8} style={styles.know}>
              <AppText variant="label" tone="textSecondary">
                {t('lf.know')}
              </AppText>
            </Tap>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingBottom: space.x4 },
  pad: { padding: layout.screenPadding },
  paper: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, gap: space.xs },
  summary: { paddingHorizontal: layout.screenPadding, paddingTop: space.xl, paddingBottom: space.lg, gap: space.sm },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  concept: { flexDirection: 'row', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.lg },
  state: { paddingTop: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 36, paddingHorizontal: space.md, borderRadius: 8, borderWidth: 1 },
  know: { paddingVertical: space.sm },
  aiNote: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingTop: space.lg },
  bar: { paddingHorizontal: layout.screenPadding, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
