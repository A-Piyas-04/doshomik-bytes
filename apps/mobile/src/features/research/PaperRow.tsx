import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PaperCard } from '@/api/types';
import { compactNumber, useLang, useT } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Tag } from '@/ui/Bits';
import { IconButton } from '@/ui/IconButton';
import { BookmarkSimple } from '@/ui/icons';
import { Tap } from '@/ui/Tap';
import { paperMeta, paperQuestion, shortAuthors } from './paper-text';
import { ReadingDots, STEP_LABEL } from './ReadingDots';

interface PaperRowProps {
  paper: PaperCard;
  onOpen: (id: string) => void;
  onToggleSave?: (id: string, save: boolean) => void;
  /** Compact rows (timelines, lineage): title and meta only. */
  compact?: boolean;
  /** Extra line under the title (lineage intent). */
  note?: string | null;
  /** Indent from the left edge (timeline rows sit beside a step number). */
  inset?: number;
}

/**
 * A paper in a list: a row, not a card. Meta in mono, the title in serif (research reads as
 * "paper"), then the question the paper asks, authors, and a footer with the reading dots and
 * the numbers. One tap target (the row) plus the save toggle.
 */
export const PaperRow = memo(function PaperRow({ paper, onOpen, onToggleSave, compact, note, inset = layout.screenPadding }: PaperRowProps) {
  const colors = useColors();
  const t = useT();
  const lang = useLang();
  const question = compact ? null : paperQuestion(paper, lang);
  const authors = compact ? null : shortAuthors(paper.authors, (n) => t('paper.authorsMore', { n }));
  const metrics = [
    paper.citation_count ? t('research.citations', { n: compactNumber(paper.citation_count) }) : null,
    paper.hf_upvotes ? t('research.upvotes', { n: compactNumber(paper.hf_upvotes) }) : null,
  ].filter(Boolean);

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface }]}>
    <Tap feedback="fill" onPress={() => onOpen(paper.id)} accessibilityLabel={paper.title} style={[styles.row, { paddingLeft: inset, paddingRight: onToggleSave ? 48 : space.lg }]}>
      <View style={styles.main}>
        <View style={styles.metaLine}>
          <AppText variant="meta" tone="textTertiary" numberOfLines={1} style={styles.meta}>
            {paperMeta(paper, lang)}
          </AppText>
          {paper.is_new ? <Tag label={t('common.new')} tone="highlight" /> : paper.is_trending ? <Tag label={t('common.trending')} tone="highlight" /> : null}
        </View>
        <AppText variant="paperRow" numberOfLines={compact ? 2 : 3}>
          {paper.title}
        </AppText>
        {note ? (
          <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
            {note}
          </AppText>
        ) : null}
        {question ? (
          <AppText variant="body" tone="textSecondary" numberOfLines={2}>
            {question}
          </AppText>
        ) : null}
        {authors ? (
          <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
            {authors}
          </AppText>
        ) : null}
        {paper.my_step > 0 || metrics.length ? (
          <View style={styles.footer}>
            {paper.my_step > 0 ? (
              <View style={styles.step}>
                <ReadingDots step={paper.my_step} />
                <AppText variant="caption" tone="accent">
                  {t(STEP_LABEL[paper.my_step as 1 | 2 | 3])}
                </AppText>
              </View>
            ) : null}
            {metrics.length ? (
              <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
                {metrics.join(' · ')}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>
    </Tap>
      {onToggleSave ? (
        <IconButton
          icon={BookmarkSimple}
          weight={paper.saved_by_me ? 'fill' : 'regular'}
          color={paper.saved_by_me ? colors.accent : colors.textSecondary}
          size={22}
          label={paper.saved_by_me ? t('research.unsave') : t('research.save')}
          selected={paper.saved_by_me}
          onPress={() => onToggleSave(paper.id, !paper.saved_by_me)}
          style={styles.save}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  row: { flexDirection: 'row', paddingVertical: space.lg },
  main: { flex: 1, gap: space.xs + 2 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs, flexWrap: 'wrap' },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  save: { position: 'absolute', top: space.sm, right: space.xs },
});
