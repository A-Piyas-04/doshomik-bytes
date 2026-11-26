import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuizzes, useTopic } from '@/api/learn';
import { useLang, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Divider, NavRow, SectionLabel, Tag } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Exam } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { ErrorState } from '@/ui/States';
import { fieldName } from '../fields';
import { LessonRow } from './LearnHome';

/** A concept: what it is, its lessons, its quizzes, and practice on it. */
export function TopicScreen({ slug }: { slug: string }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const topic = useTopic(slug);
  const quizzes = useQuizzes({ topic: slug });

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('learn.topic')} />
      {topic.isPending ? <RowsSkeleton rows={3} /> : null}
      {topic.isError ? <ErrorState onRetry={() => void topic.refetch()} /> : null}
      {topic.data ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.intro}>
            {topic.data.field ? <Tag label={fieldName(topic.data.field, lang)} tone="accent" /> : null}
            <AppText variant="display">{topic.data.name}</AppText>
            {topic.data.summary ? (
              <AppText variant="reading" tone="textSecondary">
                {topic.data.summary}
              </AppText>
            ) : null}
            <Button label={t('learn.topicPractice')} icon={Exam} kind="secondary" onPress={() => go.practiceSession({ topic: slug })} style={styles.practice} />
          </View>
          {topic.data.learn_items.length ? (
            <>
              <SectionLabel label={t('learn.lessons')} />
              <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {topic.data.learn_items.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 ? <Divider inset={layout.screenPadding + 36} /> : null}
                    <LessonRow item={item} />
                  </View>
                ))}
              </View>
            </>
          ) : null}
          {quizzes.items.length ? (
            <>
              <SectionLabel label={t('learn.quizzes')} />
              <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {quizzes.items.map((quiz, index) => (
                  <View key={quiz.id}>
                    {index > 0 ? <Divider inset={layout.screenPadding + 52} /> : null}
                    <NavRow icon={Exam} title={quiz.title} subtitle={t('practice.questions', { n: quiz.question_count })} onPress={() => go.practiceSession({ quiz: quiz.id })} />
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: space.x5 },
  intro: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, gap: space.sm },
  practice: { alignSelf: 'flex-start', marginTop: space.sm },
  surface: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
});
