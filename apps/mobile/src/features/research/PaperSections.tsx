import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { CardContent, LineagePaper, PaperCard, PaperDetail } from '@/api/types';
import { useLineage, useRelated, useToggleSave } from '@/api/research';
import { useComments } from '@/api/social';
import { useT, type MessageKey } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Divider } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { CaretDown, ChatCircle, Sparkle } from '@/ui/icons';
import { CommentRow } from '../social/CommentRow';
import { PaperRow } from './PaperRow';
import { Tap } from '@/ui/Tap';
import { RowsSkeleton } from '@/ui/Skeleton';

/** A labelled block of a Paper Card: mono label, then text. No card, no border. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <AppText variant="meta" tone="textTertiary" accessibilityRole="header">
        {label}
      </AppText>
      {children}
    </View>
  );
}

function Prose({ text }: { text: string }) {
  return <AppText variant="reading">{text}</AppText>;
}

/** Summary tab: the Paper Card's sections in reading order. */
export function SummaryTab({ paper, card }: { paper: PaperDetail; card: CardContent | null }) {
  const t = useT();
  const colors = useColors();
  const [abstractOpen, setAbstractOpen] = useState(false);
  const [openTerm, setOpenTerm] = useState<string | null>(null);

  if (!card) {
    return (
      <View style={styles.tab}>
        {paper.tldr ? (
          <Block label={t('paper.tldr')}>
            <Prose text={paper.tldr} />
          </Block>
        ) : null}
        <AppText variant="body" tone="textSecondary" style={styles.pad}>
          {t('paper.noCard')}
        </AppText>
        {paper.abstract ? (
          <Block label={t('paper.abstract')}>
            <Prose text={paper.abstract} />
          </Block>
        ) : null}
      </View>
    );
  }

  const text = (label: MessageKey, value: string | null) =>
    value ? (
      <Block key={label} label={t(label)}>
        <Prose text={value} />
      </Block>
    ) : null;

  return (
    <View style={styles.tab}>
      {text('paper.problem', card.problem)}
      {text('paper.keyIdea', card.key_idea)}
      {card.method_steps.length ? (
        <Block label={t('paper.method')}>
          <View style={styles.steps}>
            {card.method_steps.map((step, index) => (
              <View key={index} style={styles.stepRow}>
                <AppText variant="mono" tone="accent" style={styles.stepNumber}>
                  {String(index + 1).padStart(2, '0')}
                </AppText>
                <AppText variant="reading" style={styles.flex}>
                  {step}
                </AppText>
              </View>
            ))}
          </View>
        </Block>
      ) : null}
      {text('paper.data', card.data_source)}
      {text('paper.findings', card.findings)}
      {text('paper.evaluation', card.evaluation)}
      {card.figures.length ? (
        <Block label={t('paper.figures')}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.figures}>
            {card.figures.map((figure, index) => (
              <Tap key={figure.url} onPress={() => go.image(figure.url)} style={styles.figure} accessibilityLabel={figure.caption ?? t('paper.figure', { n: index + 1 })}>
                <Image source={{ uri: figure.url }} style={[styles.figureImage, { backgroundColor: colors.surface, borderColor: colors.border }]} contentFit="contain" />
                {figure.caption ? (
                  <AppText variant="caption" tone="textSecondary" numberOfLines={3}>
                    {figure.caption}
                  </AppText>
                ) : null}
              </Tap>
            ))}
          </ScrollView>
        </Block>
      ) : null}
      {text('paper.limitations', card.limitations)}
      {card.takeaway ? (
        <View style={styles.takeaway}>
          <AppText variant="meta" tone="accent">
            {t('paper.takeaway')}
          </AppText>
          <AppText variant="lead">{card.takeaway}</AppText>
        </View>
      ) : null}
      {card.glossary.length ? (
        <Block label={t('paper.glossary')}>
          <View>
            {card.glossary.map((entry) => {
              const open = openTerm === entry.term;
              return (
                <Tap key={entry.term} onPress={() => setOpenTerm(open ? null : entry.term)} style={[styles.term, { borderBottomColor: colors.divider }]} accessibilityState={{ expanded: open }}>
                  <View style={styles.termHead}>
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {entry.term}
                    </AppText>
                    <CaretDown size={16} color={colors.textTertiary} style={open ? styles.flip : undefined} />
                  </View>
                  {open ? (
                    <AppText variant="body" tone="textSecondary">
                      {entry.definition}
                    </AppText>
                  ) : null}
                </Tap>
              );
            })}
          </View>
        </Block>
      ) : null}
      {paper.abstract ? (
        <Tap onPress={() => setAbstractOpen((o) => !o)} style={styles.abstractToggle} accessibilityState={{ expanded: abstractOpen }}>
          <AppText variant="meta" tone="textTertiary" style={styles.flex}>
            {t('paper.abstract')}
          </AppText>
          <CaretDown size={16} color={colors.textTertiary} style={abstractOpen ? styles.flip : undefined} />
        </Tap>
      ) : null}
      {abstractOpen && paper.abstract ? (
        <View style={styles.pad}>
          <AppText variant="reading" tone="textSecondary">
            {paper.abstract}
          </AppText>
        </View>
      ) : null}
      {card.source === 'ai' ? (
        <View style={styles.aiNote}>
          <Sparkle size={14} color={colors.textTertiary} />
          <AppText variant="caption" tone="textTertiary" style={styles.flex}>
            {t('paper.aiNote')}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const INTENT: Record<string, MessageKey> = { background: 'paper.intentBackground', supporting: 'paper.intentSupporting', contrasting: 'paper.intentContrasting' };

/** Connections tab: what this paper builds on, what built on it, and similar papers. */
export function ConnectionsTab({ paperId }: { paperId: string }) {
  const t = useT();
  const [limit, setLimit] = useState(3);
  const lineage = useLineage(paperId, limit);
  const related = useRelated(paperId);
  const toggleSave = useToggleSave();
  const onSave = (id: string, save: boolean) => toggleSave.mutate({ id, save });

  if (lineage.isPending || related.isPending) return <RowsSkeleton rows={3} />;
  const buildsOn = lineage.data?.builds_on ?? [];
  const builtOnBy = lineage.data?.built_on_by ?? [];
  const similar = related.data ?? [];
  const intentNote = (paper: LineagePaper) =>
    [paper.intent ? t(INTENT[paper.intent]!) : null, paper.is_influential ? t('paper.influential') : null].filter(Boolean).join(' · ') || null;

  if (!buildsOn.length && !builtOnBy.length && !similar.length) {
    return (
      <AppText variant="body" tone="textSecondary" style={[styles.pad, styles.emptyTab]}>
        {t('paper.noConnections')}
      </AppText>
    );
  }

  const group = (label: MessageKey, papers: PaperCard[], note?: (p: LineagePaper) => string | null) =>
    papers.length ? (
      <View key={label}>
        <AppText variant="meta" tone="textTertiary" style={styles.groupLabel} accessibilityRole="header">
          {t(label)}
        </AppText>
        {papers.map((paper, index) => (
          <View key={paper.id}>
            {index > 0 ? <Divider /> : null}
            <PaperRow paper={paper} compact onOpen={go.paper} onToggleSave={onSave} note={note ? note(paper as LineagePaper) : null} />
          </View>
        ))}
      </View>
    ) : null;

  const more = (buildsOn.length === limit || builtOnBy.length === limit) && limit < 20;
  return (
    <View style={styles.tab}>
      {group('paper.buildsOn', buildsOn, intentNote)}
      {group('paper.builtOnBy', builtOnBy, intentNote)}
      {more ? <Button label={t('paper.showMore')} kind="ghost" size="sm" onPress={() => setLimit(20)} style={styles.more} /> : null}
      {group('paper.similar', similar)}
    </View>
  );
}

/** Discussion tab: the first comments, then one way in to write or read the whole thread. */
export function DiscussionTab({ paperId }: { paperId: string }) {
  const t = useT();
  const comments = useComments({ kind: 'papers', id: paperId });
  const preview = comments.items.slice(0, 5);
  return (
    <View style={styles.tab}>
      <View style={styles.discussHead}>
        <Button label={t('comments.placeholder')} icon={ChatCircle} kind="secondary" block onPress={() => go.comments('papers', paperId, true)} />
      </View>
      {comments.isPending ? <RowsSkeleton rows={2} avatar /> : null}
      {!comments.isPending && preview.length === 0 ? (
        <AppText variant="body" tone="textSecondary" style={[styles.pad, styles.emptyTab]}>
          {t('paper.discussionEmpty')}
        </AppText>
      ) : null}
      {preview.map((comment) => (
        <CommentRow key={comment.id} comment={comment} onReply={() => go.comments('papers', paperId)} />
      ))}
      {comments.items.length > preview.length || comments.hasNextPage ? (
        <Button label={t('common.seeAll')} kind="ghost" size="sm" onPress={() => go.comments('papers', paperId)} style={styles.more} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { paddingBottom: space.x4 },
  pad: { paddingHorizontal: layout.screenPadding },
  emptyTab: { paddingVertical: space.xxl },
  block: { paddingHorizontal: layout.screenPadding, paddingTop: space.xxl, gap: space.sm, maxWidth: layout.maxTextWidth + layout.screenPadding * 2 },
  steps: { gap: space.md },
  stepRow: { flexDirection: 'row', gap: space.md },
  stepNumber: { width: 22, paddingTop: 3 },
  flex: { flex: 1 },
  figures: { gap: space.md, paddingRight: layout.screenPadding },
  figure: { width: 240, gap: space.sm },
  figureImage: { width: 240, height: 170, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  takeaway: { paddingHorizontal: layout.screenPadding, paddingTop: space.x3, gap: space.sm },
  term: { paddingVertical: space.md, gap: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  termHead: { flexDirection: 'row', alignItems: 'center' },
  flip: { transform: [{ rotate: '180deg' }] },
  abstractToggle: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingTop: space.xxl, paddingBottom: space.sm, minHeight: 44 },
  aiNote: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingTop: space.xxl },
  groupLabel: { paddingHorizontal: layout.screenPadding, paddingTop: space.xxl },
  more: { alignSelf: 'flex-start', marginLeft: layout.screenPadding - space.sm },
  discussHead: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, paddingBottom: space.sm },
});
