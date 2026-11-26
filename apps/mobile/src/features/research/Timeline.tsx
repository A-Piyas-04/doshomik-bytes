import { StyleSheet, View } from 'react-native';
import { useToggleSave } from '@/api/research';
import type { Step } from '@/api/types';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Tag } from '@/ui/Bits';
import { PaperRow } from './PaperRow';

/** "3 of 8 read", from the reading step of each paper in a path. */
export function pathProgress(steps: Step[]) {
  const read = steps.filter((s) => s.paper.my_step > 0).length;
  const next = steps.find((s) => s.paper.my_step === 0)?.step ?? null;
  return { read, total: steps.length, next };
}

/**
 * A reading path (a roadmap or a trail) as a vertical timeline: a mono step number on a rail, the
 * paper, and the line on why it comes at that point. The first unread step is marked Next.
 */
export function Timeline({ steps }: { steps: Step[] }) {
  const t = useT();
  const colors = useColors();
  const toggleSave = useToggleSave();
  const { next } = pathProgress(steps);
  return (
    <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {steps.map((item, index) => {
        const done = item.paper.my_step > 0;
        const isNext = item.step === next;
        return (
          <View key={item.paper.id} style={styles.step}>
            <View style={styles.rail}>
              <View style={[styles.segment, { backgroundColor: index === 0 ? 'transparent' : colors.border }]} />
              <View
                style={[
                  styles.number,
                  { borderColor: done || isNext ? colors.accent : colors.border, backgroundColor: done ? colors.accent : colors.surface },
                ]}
              >
                <AppText variant="mono" weight="medium" style={{ color: done ? colors.onAccent : isNext ? colors.accent : colors.textSecondary, fontSize: 12 }}>
                  {String(item.step).padStart(2, '0')}
                </AppText>
              </View>
              <View style={[styles.segment, styles.grow, { backgroundColor: index === steps.length - 1 ? 'transparent' : colors.border }]} />
            </View>
            <View style={styles.body}>
              <PaperRow paper={item.paper} variant="row" compact inset={0} onOpen={go.paper} onToggleSave={(id, save) => toggleSave.mutate({ id, save })} />
              {isNext ? (
                <View style={styles.nextTag}>
                  <Tag label={t('roadmap.next')} tone="highlight" />
                </View>
              ) : null}
              {item.note ? (
                <AppText variant="body" tone="textSecondary" italic style={styles.note}>
                  {item.note}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  step: { flexDirection: 'row', paddingLeft: layout.screenPadding },
  rail: { width: 32, alignItems: 'center' },
  segment: { width: 2, height: 18 },
  grow: { flex: 1 },
  number: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingLeft: space.md, paddingBottom: space.lg },
  nextTag: { marginTop: -space.sm, marginBottom: space.sm },
  note: { paddingRight: layout.screenPadding, marginTop: -space.sm },
});
