import type { ReadingStep } from '@doshomik/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSaveNote, useSetStep } from '@/api/research';
import type { ReadingPass } from '@/api/types';
import { shortDate, useLang, useT, type MessageKey } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { SectionLabel } from '@/ui/Bits';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Tap } from '@/ui/Tap';
import { TextField } from '@/ui/TextField';
import { PAPER_NOTE_MAX_LENGTH } from '@doshomik/shared';

const STEPS: { step: ReadingStep; label: MessageKey; hint: MessageKey; at?: keyof ReadingPass }[] = [
  { step: 1, label: 'reading.step1', hint: 'reading.step1Hint', at: 'explored_at' },
  { step: 2, label: 'reading.step2', hint: 'reading.step2Hint', at: 'studied_at' },
  { step: 3, label: 'reading.step3', hint: 'reading.step3Hint', at: 'reproduced_at' },
];

/**
 * Your reading: a three-step stepper (Explored → Studied → Reproduced) with what each step means,
 * the date it was reached, a way back to "not started", and a private note.
 */
export function ReadingSheet({ paperId, pass, visible, onClose }: { paperId: string; pass: ReadingPass | null; visible: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const setStep = useSetStep(paperId);
  const current = pass?.step ?? 0;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('reading.title')}>
      {STEPS.map(({ step, label, hint, at }, index) => {
        const reached = step <= current;
        const isCurrent = step === current;
        const stamp = at && pass?.[at] ? shortDate(pass[at] as string, lang) : null;
        return (
          <Tap
            key={step}
            feedback="fill"
            accessibilityRole="radio"
            accessibilityState={{ selected: isCurrent }}
            onPress={() => setStep.mutate(step)}
            style={styles.step}
          >
            <View style={styles.rail}>
              <View style={[styles.line, { backgroundColor: index === 0 ? 'transparent' : reached ? colors.accent : colors.border }]} />
              <View
                style={[
                  styles.node,
                  { borderColor: reached ? colors.accent : colors.textTertiary, backgroundColor: reached ? colors.accent : colors.bg },
                ]}
              />
              <View style={[styles.line, { backgroundColor: index === STEPS.length - 1 ? 'transparent' : step < current ? colors.accent : colors.border }]} />
            </View>
            <View style={styles.text}>
              <View style={styles.titleRow}>
                <AppText variant="bodyStrong" tone={isCurrent ? 'accent' : 'text'}>
                  {t(label)}
                </AppText>
                {stamp && reached ? (
                  <AppText variant="caption" tone="textTertiary">
                    {stamp}
                  </AppText>
                ) : null}
              </View>
              <AppText variant="caption" tone="textSecondary">
                {t(hint)}
              </AppText>
            </View>
          </Tap>
        );
      })}
      {current > 0 ? (
        <Tap onPress={() => setStep.mutate(0)} style={styles.reset} accessibilityHint={t('reading.resetHint')}>
          <AppText variant="label" tone="textTertiary">
            {t('reading.notStarted')}
          </AppText>
        </Tap>
      ) : null}

      <SectionLabel label={t('reading.note')} />
      <NoteEditor paperId={paperId} saved={pass?.note ?? null} />
    </BottomSheet>
  );
}

/** The private note; mounted with the sheet, so it starts from what is saved. */
function NoteEditor({ paperId, saved }: { paperId: string; saved: string | null }) {
  const t = useT();
  const saveNote = useSaveNote(paperId);
  const [note, setNote] = useState(saved ?? '');
  const noteChanged = (note.trim() || null) !== saved;
  return (
      <View style={styles.note}>
        <TextField
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={PAPER_NOTE_MAX_LENGTH}
          counter
          placeholder={t('reading.notePlaceholder')}
          hint={t('reading.noteHint')}
          accessibilityLabel={t('reading.note')}
        />
        <Button
          label={t('reading.saveNote')}
          kind="secondary"
          disabled={!noteChanged}
          loading={saveNote.isPending}
          onPress={() => saveNote.mutate(note.trim() || null)}
        />
      </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: space.md, paddingHorizontal: layout.screenPadding, minHeight: 64 },
  rail: { width: 16, alignItems: 'center' },
  line: { width: 2, flex: 1 },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  text: { flex: 1, paddingVertical: space.md, gap: 2 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm },
  reset: { alignSelf: 'flex-start', marginLeft: layout.screenPadding + 28, paddingVertical: space.sm },
  note: { paddingHorizontal: layout.screenPadding, gap: space.md },
});
