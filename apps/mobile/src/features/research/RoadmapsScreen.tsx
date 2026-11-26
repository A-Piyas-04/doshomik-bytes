import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFields, useInterests, useRoadmap } from '@/api/research';
import { useLang, useT } from '@/i18n';
import { useColors } from '@/theme/theme';
import { useArea, useAreaPalette, useWash } from '@/theme/area';
import { radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { ChipRow } from '@/ui/Chips';
import { MapTrifold } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { AreaGlyph, areaIcon, fieldName } from '../fields';
import { pathProgress, Timeline } from './Timeline';

/**
 * Roadmaps: one screen. Pick a field with the chips (it opens on the field asked for, else the
 * user's first interest, else the first field), then read its papers in order.
 */
export function RoadmapsScreen({ initialField }: { initialField?: string }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const wash = useWash();
  const fields = useFields();
  const interests = useInterests();
  const [picked, setPicked] = useState<string | undefined>(initialField);
  const field = picked ?? interests.data?.[0]?.slug ?? fields.data?.[0]?.slug;
  const roadmap = useRoadmap(field);

  const palette = useAreaPalette();
  const area = useArea(field);
  const options = (fields.data ?? []).map((f) => {
    const c = palette(f.slug);
    return { value: f.slug, label: fieldName(f, lang), icon: areaIcon(f.slug), color: { solid: c.solid, on: c.on } };
  });
  const steps = roadmap.data?.steps ?? [];
  const progress = pathProgress(steps);
  const current = fields.data?.find((f) => f.slug === field);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('roadmap.title')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {field ? <ChipRow options={options} value={field} onChange={setPicked} style={styles.chips} /> : null}
        {current ? (
          <View style={[styles.intro, { backgroundColor: wash(area.solid) }]}>
            <AreaGlyph slug={field} size={112} weight="fill" color={area.solid} style={styles.glyph} />
            <AppText variant="display">{fieldName(current, lang)}</AppText>
            {current.description ? (
              <AppText variant="body" tone="textSecondary" style={styles.description}>
                {current.description}
              </AppText>
            ) : null}
            {steps.length ? (
              <View style={styles.progress}>
                <View style={styles.track}>
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]} />
                  <View style={[styles.fill, { width: `${Math.round((progress.read / Math.max(1, progress.total)) * 100)}%`, backgroundColor: area.solid }]} />
                </View>
                <AppText variant="label" weight="semibold" tone="text">
                  {t('roadmap.progress', { read: progress.read, total: progress.total })}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
        {roadmap.isPending || fields.isPending ? <RowsSkeleton rows={3} /> : null}
        {roadmap.isError ? <ErrorState onRetry={() => void roadmap.refetch()} /> : null}
        {roadmap.data && !steps.length ? <EmptyState icon={MapTrifold} message={t('roadmap.empty')} /> : null}
        {steps.length ? <Timeline steps={steps} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: space.x5 },
  chips: { flexGrow: 0, paddingTop: space.md },
  intro: { marginHorizontal: space.md, marginTop: space.md, marginBottom: space.sm, padding: space.lg, borderRadius: radius.lg, gap: space.sm, overflow: 'hidden' },
  glyph: { position: 'absolute', right: -16, bottom: -22, opacity: 0.28 },
  description: { maxWidth: '86%' },
  progress: { gap: 6, marginTop: space.xs },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', maxWidth: '70%' },
  fill: { height: 6, borderRadius: 3 },
});
