import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PaperCard } from '@/api/types';
import { compactNumber, useLang, useT } from '@/i18n';
import { useArea } from '@/theme/area';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Tag } from '@/ui/Bits';
import { IconButton } from '@/ui/IconButton';
import { BookmarkSimple, Fire, Sparkle } from '@/ui/icons';
import { Tap } from '@/ui/Tap';
import { areaIcon, fieldName } from '../fields';
import { paperQuestion, shortAuthors } from './paper-text';
import { ReadingDots, STEP_LABEL } from './ReadingDots';

interface PaperRowProps {
  paper: PaperCard;
  onOpen: (id: string) => void;
  onToggleSave?: (id: string, save: boolean) => void;
  /**
   * `card` (lists: a white card of its own, with the area's colour) or `row` (inside a timeline or
   * a group that is already a surface: no card around it).
   */
  variant?: 'card' | 'row';
  /** Title and meta only. */
  compact?: boolean;
  /** Extra line under the title (lineage intent). */
  note?: string | null;
  /** Row variant: indent from the left edge (timeline rows sit beside a step number). */
  inset?: number;
  /** Card variant: a fixed width (horizontal carousels). */
  width?: number;
}

/**
 * A paper in a list. The area badge carries the area's colour, the title is serif (research reads
 * as "paper"), then the question the paper asks, the authors, and a footer with the reading dots
 * and the numbers. One tap target (the paper) plus the save toggle.
 */
export const PaperRow = memo(function PaperRow({ paper, onOpen, onToggleSave, variant = 'card', compact, note, inset = layout.screenPadding, width }: PaperRowProps) {
  const colors = useColors();
  const t = useT();
  const lang = useLang();
  const area = useArea(paper.field.slug);
  const AreaGlyph = areaIcon(paper.field.slug);
  const card = variant === 'card';
  const question = compact ? null : paperQuestion(paper, lang);
  const authors = compact ? null : shortAuthors(paper.authors, (n) => t('paper.authorsMore', { n }));
  const when = paper.venue ?? (paper.year ? String(paper.year) : null);
  const metrics = [
    paper.citation_count ? t('research.citations', { n: compactNumber(paper.citation_count) }) : null,
    paper.hf_upvotes ? t('research.upvotes', { n: compactNumber(paper.hf_upvotes) }) : null,
  ].filter(Boolean);

  return (
    <View
      style={[
        card ? [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }] : styles.rowWrap,
        width ? { width, marginHorizontal: 0 } : null,
      ]}
    >
      <Tap
        feedback="fill"
        onPress={() => onOpen(paper.id)}
        accessibilityLabel={paper.title}
        style={[card ? styles.cardInner : [styles.row, { paddingLeft: inset }], { paddingRight: onToggleSave ? 48 : space.lg }]}
      >
        <View style={styles.tags}>
          <Tag label={fieldName(paper.field, lang)} color={area} icon={AreaGlyph} />
          {paper.is_new ? (
            <Tag label={t('common.new')} tone="highlight" icon={Sparkle} />
          ) : paper.is_trending ? (
            <Tag label={t('common.trending')} tone="highlight" icon={Fire} />
          ) : null}
          {when ? (
            <AppText variant="meta" tone="textTertiary" numberOfLines={1} style={styles.when}>
              {when}
            </AppText>
          ) : null}
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
                <AppText variant="caption" weight="semibold" tone="accent">
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
  card: { marginHorizontal: space.md, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  cardInner: { paddingLeft: space.lg, paddingVertical: space.lg, gap: space.sm },
  rowWrap: { position: 'relative' },
  row: { paddingVertical: space.lg, gap: space.xs + 2 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  when: { flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 2, flexWrap: 'wrap' },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  save: { position: 'absolute', top: space.xs, right: space.xs },
});
