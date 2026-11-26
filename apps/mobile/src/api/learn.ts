import { useMutation, useQuery } from '@tanstack/react-query';
import { translate } from '@/i18n';
import { success, warning } from '@/lib/haptics';
import { toast } from '@/ui/Toast';
import { api } from './client';
import { useCursorList } from './paging';
import { keys, queryClient } from './query';
import type { AnswerResult, Course, CourseDetail, HistoryEntry, LearnItem, PracticeStats, Question, Quiz, QuizDetail, SearchResults, Suggestion2, Topic, TopicDetail } from './types';

const failed = () => toast(translate('common.actionFailed'), { tone: 'error' });

// ---------- Learn ----------

export function useTopics(field?: string) {
  return useQuery({
    queryKey: keys.topics(field),
    queryFn: ({ signal }) => api.get<{ items: Topic[] }>('/topics', { field }, signal).then((r) => r.items),
    staleTime: 30 * 60_000,
    meta: { persist: !field },
  });
}

export function useTopic(slug: string) {
  return useQuery({ queryKey: keys.topic(slug), queryFn: ({ signal }) => api.get<TopicDetail>(`/topics/${slug}`, undefined, signal) });
}

export const useCourses = (field?: string) => useCursorList<Course>(keys.courses(field), '/courses', { field }, { persist: !field });
export const useMyCourses = () => useCursorList<Course>(keys.myCourses, '/me/courses', {}, { limit: 5 });
export const useLearnItems = (filter: { field?: string; topic?: string }) =>
  useCursorList<LearnItem>(keys.learnItems(filter), '/learn-items', filter, { limit: 50 });

export function useCourse(id: string, enabled = true) {
  return useQuery({ queryKey: keys.course(id), queryFn: ({ signal }) => api.get<CourseDetail>(`/courses/${id}`, undefined, signal), enabled: enabled && !!id });
}

export function useLearnItem(id: string) {
  return useQuery({ queryKey: keys.learnItem(id), queryFn: ({ signal }) => api.get<LearnItem>(`/learn-items/${id}`, undefined, signal) });
}

/** Records the step reached in one of our courses. The server marks the steps' lessons as done. */
export function useSaveProgress(courseId: string) {
  return useMutation({
    mutationFn: (lastPosition: number) => api.put<{ last_position: number; completed_at: string | null }>(`/courses/${courseId}/progress`, { last_position: lastPosition }),
    onSuccess: (progress) => {
      queryClient.setQueryData<CourseDetail>(keys.course(courseId), (course) =>
        course ? { ...course, my_progress: { last_position: progress.last_position, completed_at: progress.completed_at } } : course,
      );
      void queryClient.invalidateQueries({ queryKey: keys.myCourses });
      void queryClient.invalidateQueries({ queryKey: ['courses'] });
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'paper' && q.queryKey[2] === 'learn-first' });
    },
  });
}

/** Done / not done for a lesson or note: feeds every paper's Learn first. */
export function useCompleteLearnItem() {
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => (done ? api.put(`/learn-items/${id}/complete`) : api.delete(`/learn-items/${id}/complete`)),
    onMutate: ({ done }) => {
      if (done) success();
    },
    onSettled: () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'paper' && q.queryKey[2] === 'learn-first' }),
    onError: failed,
  });
}

// ---------- Practice ----------

export const useQuizzes = (filter: { field?: string; topic?: string }) => useCursorList<Quiz>(keys.quizzes(filter), '/quizzes', filter);

export function useQuiz(id: string | undefined) {
  return useQuery({ queryKey: keys.quiz(id ?? ''), queryFn: ({ signal }) => api.get<QuizDetail>(`/quizzes/${id}`, undefined, signal), enabled: !!id });
}

/** A practice set: random questions, fetched once per session (the session key keeps it stable). */
export function usePracticeSet(filter: { field?: string; topic?: string }, session: string, enabled: boolean) {
  return useQuery({
    queryKey: ['practice', 'set', filter, session],
    queryFn: ({ signal }) => api.get<{ items: Question[] }>('/practice/questions', { ...filter, limit: 10 }, signal).then((r) => r.items),
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}

export function useAnswer() {
  return useMutation({
    mutationFn: ({ questionId, answer }: { questionId: string; answer: string }) => api.post<AnswerResult>(`/practice/questions/${questionId}/answer`, { answer }),
    onSuccess: (result) => {
      if (result.correct) success();
      else warning();
      void queryClient.invalidateQueries({ queryKey: ['me', 'practice'] });
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'paper' && q.queryKey[2] === 'learn-first' });
    },
    onError: failed,
  });
}

export function usePracticeStats() {
  return useQuery({ queryKey: keys.practiceStats, queryFn: ({ signal }) => api.get<PracticeStats>('/me/practice/stats', undefined, signal) });
}

export const usePracticeHistory = () => useCursorList<HistoryEntry>(keys.practiceHistory, '/me/practice/history', {}, { limit: 30 });

// ---------- Search ----------

export function useSearch(q: string, type?: keyof SearchResults) {
  return useQuery({
    queryKey: keys.search(q, type),
    queryFn: ({ signal }) => api.get<SearchResults>('/search', { q, type, limit: type ? 30 : 4 }, signal),
    enabled: q.trim().length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useSuggest(q: string) {
  return useQuery({
    queryKey: keys.suggest(q),
    queryFn: ({ signal }) => api.get<{ items: Suggestion2[] }>('/search/suggest', { q }, signal).then((r) => r.items),
    enabled: q.trim().length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}
