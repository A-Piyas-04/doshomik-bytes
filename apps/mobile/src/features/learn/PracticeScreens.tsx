import { router, usePreventRemove } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useAnswer, usePracticeHistory, usePracticeSet, usePracticeStats, useQuiz, useQuizzes } from '@/api/learn';
import type { AnswerResult, HistoryEntry, Question, Quiz } from '@/api/types';
import { relativeTime, useLang, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { confirm } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { Divider, ListFooter, NavRow, SectionLabel } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { CheckCircle, Clock as ClockGlyph, Exam, Shuffle, XCircle as XCircleGlyph } from '@/ui/icons';
import { KeyboardView } from '@/ui/Keyboard';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState, ErrorState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { TextField } from '@/ui/TextField';
import { ALL, FieldChips } from '../fields';

/** Practice: how you're doing, start a set (an area or Random), named quizzes, and history. */
export function PracticeScreen() {
  const t = useT();
  const colors = useColors();
  const stats = usePracticeStats();
  const [area, setArea] = useState(ALL);
  const quizzes = useQuizzes({ field: area === ALL ? undefined : area });
  const s = stats.data;
  const acc = s?.accuracy != null ? Math.round(s.accuracy * 100) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('practice.title')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.statsBlock}>
          {acc !== null && s ? (
            <>
              <AppText variant="display">{`${acc}%`}</AppText>
              <AppText variant="body" tone="textSecondary">
                {s.streak_days > 1 ? t('practice.stats', { acc, streak: s.streak_days }) : t('practice.statsNoStreak', { acc })}
              </AppText>
            </>
          ) : (
            <AppText variant="body" tone="textSecondary">
              {t('practice.statsNone')}
            </AppText>
          )}
        </View>

        <SectionLabel label={t('practice.from')} />
        <FieldChips value={area} onChange={setArea} style={styles.chips} />
        <View style={styles.start}>
          <Button label={t('practice.start')} block onPress={() => go.practiceSession({ field: area === ALL ? undefined : area })} />
          {area === ALL ? null : <Button label={t('practice.random')} icon={Shuffle} kind="secondary" onPress={() => go.practiceSession({})} />}
        </View>

        <SectionLabel label={t('practice.quizzes')} />
        <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {quizzes.isPending ? <RowsSkeleton rows={2} /> : null}
          {!quizzes.isPending && quizzes.items.length === 0 ? (
            <AppText variant="body" tone="textSecondary" style={styles.pad}>
              {t('practice.empty')}
            </AppText>
          ) : null}
          {quizzes.items.map((quiz: Quiz, index) => (
            <View key={quiz.id}>
              {index > 0 ? <Divider inset={layout.screenPadding + 52} /> : null}
              <NavRow icon={Exam} title={quiz.title} subtitle={[quiz.topic?.name, t('practice.questions', { n: quiz.question_count })].filter(Boolean).join(' · ')} onPress={() => go.practiceSession({ quiz: quiz.id })} />
            </View>
          ))}
        </View>

        <SectionLabel label={t('practice.history')} />
        <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <NavRow icon={ClockGlyph} title={t('practice.history')} subtitle={s ? `${s.attempts} · ${s.correct}` : undefined} onPress={go.practiceHistory} />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * A practice session: one question per screen. Options are large rows; short answers get a text
 * box. After Submit: right or wrong with an icon and a colour, the answer and why, then Next.
 * The end shows the score. Every answer is saved as it is given.
 */
export function PracticeSessionScreen({ field, topic, quiz }: { field?: string; topic?: string; quiz?: string }) {
  const t = useT();
  const colors = useColors();
  const [session] = useState(() => String(Date.now()));
  const set = usePracticeSet({ field, topic }, session, !quiz);
  const named = useQuiz(quiz);
  const questions: Question[] = useMemo(() => (quiz ? (named.data?.questions ?? []) : (set.data ?? [])), [quiz, named.data, set.data]);
  const loading = quiz ? named.isPending : set.isPending;
  const failed = quiz ? named.isError : set.isError;
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const answer = useAnswer();

  const [leaving, setLeaving] = useState(false);
  const inProgress = index > 0 && !finished && !leaving;
  usePreventRemove(inProgress, ({ repeat }) => {
    void confirm({ title: t('practice.leaveTitle'), message: t('practice.leaveBody'), confirmLabel: t('practice.leave') }).then((ok) => {
      if (!ok) return;
      setLeaving(true);
      repeat();
    });
  });

  const question = questions[index];
  const title = quiz ? (named.data?.title ?? t('practice.title')) : t('practice.title');

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader title={title} />
        <RowsSkeleton rows={3} />
      </View>
    );
  }
  if (failed) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader title={title} />
        <ErrorState onRetry={() => void (quiz ? named.refetch() : set.refetch())} />
      </View>
    );
  }
  if (!questions.length) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader title={title} />
        <EmptyState icon={Exam} message={t('practice.empty')} />
      </View>
    );
  }

  if (finished) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader title={title} leading="close" />
        <View style={styles.result}>
          <AppText variant="meta" tone="textTertiary">
            {title}
          </AppText>
          <AppText variant="display">{t('practice.score', { c: score, t: questions.length })}</AppText>
          <View style={styles.resultActions}>
            {!quiz ? (
              <Button label={t('practice.again')} onPress={() => router.replace({ pathname: '/practice/session', params: Object.fromEntries(Object.entries({ field, topic }).filter(([, v]) => !!v)) as Record<string, string> })} />
            ) : null}
            <Button label={t('common.done')} kind="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </View>
    );
  }

  const given = question!.kind === 'mcq' ? choice : typed.trim();
  const submit = () => {
    if (!given) return;
    answer.mutate(
      { questionId: question!.id, answer: given },
      {
        onSuccess: (res) => {
          setResult(res);
          if (res.correct) setScore((n) => n + 1);
        },
      },
    );
  };
  const next = () => {
    if (index + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setChoice(null);
    setTyped('');
    setResult(null);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={title} />
      <View style={[styles.progress, { backgroundColor: colors.border }]}>
        <View style={[styles.progressFill, { backgroundColor: colors.accent, width: `${((index + (result ? 1 : 0)) / questions.length) * 100}%` }]} />
      </View>
      <KeyboardView>
        <ScrollView contentContainerStyle={styles.questionScroll} keyboardShouldPersistTaps="handled">
          <AppText variant="meta" tone="textTertiary">
            {[t('practice.progress', { n: index + 1, total: questions.length }), question!.topic?.name].filter(Boolean).join(' · ')}
          </AppText>
          <AppText variant="title" style={styles.prompt}>
            {question!.prompt}
          </AppText>

          {question!.kind === 'mcq' ? (
            <View style={styles.options} accessibilityRole="radiogroup">
              {(question!.options ?? []).map((option) => {
                const picked = choice === option;
                const isAnswer = !!result && option === result.correct_answer;
                const wrongPick = !!result && picked && !result.correct;
                const border = isAnswer ? colors.success : wrongPick ? colors.danger : picked ? colors.inverse : colors.border;
                return (
                  <Tap
                    key={option}
                    disabled={!!result}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: picked, disabled: !!result }}
                    onPress={() => setChoice(option)}
                    style={[styles.option, { borderColor: border, backgroundColor: isAnswer ? colors.accentWash : colors.surface, borderWidth: picked || isAnswer ? 2 : 1 }]}
                  >
                    <AppText variant="body" weight={picked ? 'semibold' : 'regular'} style={styles.flex}>
                      {option}
                    </AppText>
                    {isAnswer ? <CheckCircle size={22} weight="fill" color={colors.success} /> : wrongPick ? <XCircleGlyph size={22} weight="fill" color={colors.danger} /> : null}
                  </Tap>
                );
              })}
            </View>
          ) : (
            <TextField
              value={typed}
              onChangeText={setTyped}
              editable={!result}
              placeholder={t('practice.typeAnswer')}
              accessibilityLabel={t('practice.typeAnswer')}
              onSubmitEditing={submit}
              returnKeyType="done"
              containerStyle={styles.options}
            />
          )}

          {result ? (
            <View style={[styles.feedback, { backgroundColor: colors.surface, borderColor: result.correct ? colors.success : colors.danger }]} accessibilityLiveRegion="polite">
              <View style={styles.feedbackHead}>
                {result.correct ? <CheckCircle size={22} weight="fill" color={colors.success} /> : <XCircleGlyph size={22} weight="fill" color={colors.danger} />}
                <AppText variant="bodyStrong" style={{ color: result.correct ? colors.success : colors.danger }}>
                  {result.correct ? t('practice.correct') : t('practice.incorrect')}
                </AppText>
              </View>
              {!result.correct ? <AppText variant="body">{t('practice.answer', { a: result.correct_answer })}</AppText> : null}
              {result.explanation ? (
                <>
                  <AppText variant="meta" tone="textTertiary">
                    {t('practice.why')}
                  </AppText>
                  <AppText variant="body" tone="textSecondary">
                    {result.explanation}
                  </AppText>
                </>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          {result ? (
            <Button label={index + 1 >= questions.length ? t('practice.finish') : t('practice.next')} block onPress={next} />
          ) : (
            <Button label={t('practice.submit')} block disabled={!given} loading={answer.isPending} onPress={submit} />
          )}
        </View>
      </KeyboardView>
    </View>
  );
}

/** Every answer given, newest first, marked right or wrong. */
export function PracticeHistoryScreen() {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const history = usePracticeHistory();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('practice.history')} />
      <FlashList
        data={history.items}
        keyExtractor={(item, i) => `${item.question_id}-${item.created_at}-${i}`}
        renderItem={({ item }: { item: HistoryEntry }) => (
          <View style={[styles.historyRow, { backgroundColor: colors.surface, borderBottomColor: colors.divider }]}>
            {item.is_correct ? <CheckCircle size={20} weight="fill" color={colors.success} /> : <XCircleGlyph size={20} weight="fill" color={colors.danger} />}
            <View style={styles.flex}>
              <AppText variant="body" numberOfLines={2}>
                {item.prompt}
              </AppText>
              <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
                {[item.answer, item.topic?.name, relativeTime(item.created_at, lang)].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>
        )}
        ListEmptyComponent={history.isPending ? <RowsSkeleton rows={4} /> : <EmptyState icon={ClockGlyph} message={t('practice.historyEmpty')} />}
        onEndReached={history.loadMore}
        ListFooterComponent={<ListFooter loading={history.isFetchingNextPage} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingBottom: space.x5 },
  pad: { padding: layout.screenPadding },
  statsBlock: { paddingHorizontal: layout.screenPadding, paddingTop: space.xl, gap: space.xs },
  chips: { flexGrow: 0 },
  start: { flexDirection: 'row', gap: space.sm, paddingHorizontal: layout.screenPadding, paddingTop: space.md },
  surface: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  progress: { height: 3 },
  progressFill: { height: 3 },
  questionScroll: { padding: layout.screenPadding, paddingTop: space.xl, gap: space.md },
  prompt: { marginBottom: space.sm },
  options: { gap: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.sm },
  feedback: { marginTop: space.md, borderRadius: radius.md, borderWidth: 1, padding: space.lg, gap: space.sm },
  feedbackHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bar: { paddingHorizontal: layout.screenPadding, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  result: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: layout.screenPadding },
  resultActions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
});
