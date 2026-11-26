import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFields, useInterests, useRoadmap } from '@/api/research';
import { useLang, useT } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { ChipRow } from '@/ui/Chips';
import { MapTrifold } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { fieldName } from '../fields';
import { pathProgress, Timeline } from './Timeline';

/**
 * Roadmaps: one screen. Pick a field with the chips (it opens on the field asked for, else the
 * user's first interest, else the first field), then read its papers in order.
 */
export function RoadmapsScreen({ initialField }: { initialField?: string }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const fields = useFields();
  const interests = useInterests();
  const [picked, setPicked] = useState<string | undefined>(initialField);
  const field = picked ?? interests.data?.[0]?.slug ?? fields.data?.[0]?.slug;
  const roadmap = useRoadmap(field);

  const options = (fields.data ?? []).map((f) => ({ value: f.slug, label: fieldName(f, lang) }));
  const steps = roadmap.data?.steps ?? [];
  const progress = pathProgress(steps);
  const current = fields.data?.find((f) => f.slug === field);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('roadmap.title')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {field ? <ChipRow options={options} value={field} onChange={setPicked} style={styles.chips} /> : null}
        {current ? (
          <View style={styles.intro}>
            <AppText variant="title">{fieldName(current, lang)}</AppText>
            {current.description ? (
              <AppText variant="body" tone="textSecondary">
                {current.description}
              </AppText>
            ) : null}
            {steps.length ? (
              <AppText variant="label" tone="accent">
                {t('roadmap.progress', { read: progress.read, total: progress.total })}
              </AppText>
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
  intro: { paddingHorizontal: layout.screenPadding, paddingTop: space.xl, paddingBottom: space.lg, gap: space.sm },
});
