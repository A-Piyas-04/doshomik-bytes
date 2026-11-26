import type { ContentLang, ReadingStep, ReportReason, ReportTargetType } from '@doshomik/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { translate } from '@/i18n';
import { success, tick } from '@/lib/haptics';
import { toast } from '@/ui/Toast';
import { patchEverywhere, restore } from './cache';
import { api } from './client';
import { useCursorList } from './paging';
import { keys, queryClient } from './query';
import type {
  Field,
  LearnFirst,
  Lineage,
  PaperCard,
  PaperDetail,
  ReadingPass,
  ReadingStats,
  Ref,
  Roadmap,
  Trail,
  TrailDetail,
  UserReadingStats,
} from './types';

const failed = () => toast(translate('common.actionFailed'), { tone: 'error' });

// ---------- Reads ----------

export function useFields() {
  return useQuery({
    queryKey: keys.fields,
    queryFn: ({ signal }) => api.get<{ items: Field[] }>('/fields', undefined, signal).then((r) => r.items),
    staleTime: 60 * 60_000,
    meta: { persist: true },
  });
}

export function useInterests() {
  return useQuery({
    queryKey: keys.interests,
    queryFn: ({ signal }) => api.get<{ items: Ref[] }>('/me/interests', undefined, signal).then((r) => r.items),
    meta: { persist: true },
  });
}

export function usePapers(filter: { field?: string; sort?: 'trend' | 'newest'; interests?: boolean; q?: string }, enabled = true) {
  return useCursorList<PaperCard>(
    keys.papers(filter),
    '/papers',
    { field: filter.field, sort: filter.sort, interests: filter.interests ? 'true' : undefined, q: filter.q },
    { enabled, persist: !filter.q },
  );
}

export function usePaper(id: string, enabled = true) {
  return useQuery({ queryKey: keys.paper(id), queryFn: ({ signal }) => api.get<PaperDetail>(`/papers/${id}`, undefined, signal), enabled: enabled && !!id });
}

export function useLearnFirst(id: string) {
  return useQuery({ queryKey: keys.learnFirst(id), queryFn: ({ signal }) => api.get<LearnFirst>(`/papers/${id}/learn-first`, undefined, signal) });
}

export function useLineage(id: string, limit: number, enabled = true) {
  return useQuery({
    queryKey: keys.lineage(id, limit),
    queryFn: ({ signal }) => api.get<Lineage>(`/papers/${id}/lineage`, { limit }, signal),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useRelated(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.related(id),
    queryFn: ({ signal }) => api.get<{ items: PaperCard[] }>(`/papers/${id}/related`, { limit: 5 }, signal).then((r) => r.items),
    enabled,
  });
}

export function useUpNext() {
  return useQuery({
    queryKey: keys.upNext,
    queryFn: ({ signal }) => api.get<{ paper: PaperCard | null }>('/me/papers/up-next', undefined, signal).then((r) => r.paper),
    meta: { persist: true },
  });
}

export function useReadingStats() {
  return useQuery({
    queryKey: keys.readingStats,
    queryFn: ({ signal }) => api.get<ReadingStats>('/me/reading/stats', undefined, signal),
    meta: { persist: true },
  });
}

export function useMyPapers(list: 'saved' | 'read') {
  return useCursorList<PaperCard>(keys.myPapers(list), '/me/papers', { list });
}

export function useUserReading(userId: string, enabled = true) {
  return useQuery({
    queryKey: keys.userReading(userId),
    queryFn: ({ signal }) => api.get<UserReadingStats>(`/users/${userId}/reading`, undefined, signal),
    enabled,
  });
}

export function useRoadmap(field: string | undefined) {
  return useQuery({
    queryKey: keys.roadmap(field ?? ''),
    queryFn: ({ signal }) => api.get<Roadmap>(`/fields/${field}/roadmap`, undefined, signal),
    enabled: !!field,
  });
}

export function useTrails(field?: string) {
  return useCursorList<Trail>(keys.trails(field), '/trails', { field });
}

export function useUserTrails(userId: string | undefined) {
  return useCursorList<Trail>(keys.userTrails(userId ?? ''), `/users/${userId}/trails`, {}, { enabled: !!userId });
}

export function useTrail(id: string | undefined) {
  return useQuery({
    queryKey: keys.trail(id ?? ''),
    queryFn: ({ signal }) => api.get<TrailDetail>(`/trails/${id}`, undefined, signal),
    enabled: !!id,
  });
}

// ---------- Saving and the reading tracker ----------

const invalidateMyReading = () => {
  void queryClient.invalidateQueries({ queryKey: ['me', 'papers'] });
  void queryClient.invalidateQueries({ queryKey: keys.readingStats });
};

/** Save or unsave a paper, everywhere at once; rolls back with a toast if the request fails. */
export function useToggleSave() {
  return useMutation({
    mutationFn: ({ id, save }: { id: string; save: boolean }) => (save ? api.put(`/papers/${id}/save`) : api.delete(`/papers/${id}/save`)),
    onMutate: ({ id, save }) => {
      tick();
      return patchEverywhere<PaperCard>(id, 'saved_by_me', { saved_by_me: save });
    },
    onSuccess: (_, { save }) => {
      if (save) toast(translate('research.savedToast'));
    },
    onError: (_, __, snapshot) => {
      if (snapshot) restore(snapshot);
      failed();
    },
    onSettled: invalidateMyReading,
  });
}

function applyPass(id: string, pass: ReadingPass) {
  const snapshot = patchEverywhere<PaperCard>(id, 'my_step', { my_step: pass.step });
  queryClient.setQueryData<PaperDetail>(keys.paper(id), (paper) => (paper ? { ...paper, my_step: pass.step, my_reading: pass } : paper));
  return snapshot;
}

/** One tap: step 1 ("Explored"), never lowering a higher step. */
export function useMarkRead(id: string) {
  return useMutation({
    mutationFn: () => api.post<ReadingPass & { paper_id: string }>(`/papers/${id}/mark-read`),
    onMutate: () => {
      success();
      return patchEverywhere<PaperCard>(id, 'my_step', { my_step: 1 });
    },
    onSuccess: (pass) => applyPass(id, pass),
    onError: (_, __, snapshot) => {
      if (snapshot) restore(snapshot);
      failed();
    },
    onSettled: invalidateMyReading,
  });
}

/** Sets the exact step (0 clears progress). */
export function useSetStep(id: string) {
  return useMutation({
    mutationFn: (step: ReadingStep) => api.put<ReadingPass & { paper_id: string }>(`/papers/${id}/reading`, { step }),
    onMutate: (step) => {
      tick();
      return patchEverywhere<PaperCard>(id, 'my_step', { my_step: step });
    },
    onSuccess: (pass) => applyPass(id, pass),
    onError: (_, __, snapshot) => {
      if (snapshot) restore(snapshot);
      failed();
    },
    onSettled: invalidateMyReading,
  });
}

export function useSaveNote(id: string) {
  return useMutation({
    mutationFn: (note: string | null) => api.put<ReadingPass & { paper_id: string }>(`/papers/${id}/note`, { note }),
    onSuccess: (pass) => {
      queryClient.setQueryData<PaperDetail>(keys.paper(id), (paper) => (paper ? { ...paper, my_reading: pass } : paper));
      toast(translate('reading.noteSaved'));
    },
    onError: failed,
  });
}

// ---------- Learn before reading ----------

export function useKnowTopic() {
  return useMutation({
    mutationFn: ({ slug, known }: { slug: string; known: boolean }) => (known ? api.put(`/topics/${slug}/known`) : api.delete(`/topics/${slug}/known`)),
    onMutate: ({ known }) => {
      if (known) tick();
    },
    onError: failed,
    onSettled: () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'paper' && q.queryKey[2] === 'learn-first' }),
  });
}

// ---------- Interests ----------

export function useSetInterests() {
  return useMutation({
    mutationFn: (fields: string[]) => api.put<{ items: Ref[] }>('/me/interests', { fields }),
    onSuccess: (result) => {
      queryClient.setQueryData(keys.interests, result.items);
      void queryClient.invalidateQueries({ queryKey: ['papers'] });
      toast(translate('int.saved'));
    },
    onError: failed,
  });
}

// ---------- Trails ----------

export interface TrailInput {
  title: string;
  description: string | null;
  lang: ContentLang;
  field: string | null;
  items: { paper_id: string; note: string | null }[];
}

const invalidateTrails = (id?: string) => {
  void queryClient.invalidateQueries({ queryKey: ['trails'] });
  void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'user' && q.queryKey[2] === 'trails' });
  if (id) void queryClient.invalidateQueries({ queryKey: keys.trail(id) });
};

export function useCreateTrail() {
  return useMutation({
    mutationFn: ({ input, publish }: { input: TrailInput; publish: boolean }) => api.post<TrailDetail>('/trails', { ...input, publish }),
    onSuccess: (trail) => {
      queryClient.setQueryData(keys.trail(trail.id), trail);
      invalidateTrails();
    },
  });
}

/** Saves an existing trail: fields, then steps, then (optionally) its status. */
export function useSaveTrail(id: string) {
  return useMutation({
    mutationFn: async ({ input, status }: { input: TrailInput; status?: 'draft' | 'published' }) => {
      const { items, ...fields } = input;
      await api.patch<TrailDetail>(`/trails/${id}`, fields);
      let trail = await api.put<TrailDetail>(`/trails/${id}/items`, { items });
      if (status && status !== trail.status) trail = await api.put<TrailDetail>(`/trails/${id}/status`, { status });
      return trail;
    },
    onSuccess: (trail) => {
      queryClient.setQueryData(keys.trail(id), trail);
      invalidateTrails(id);
    },
  });
}

export function useTrailStatus(id: string) {
  return useMutation({
    mutationFn: (status: 'draft' | 'published') => api.put<TrailDetail>(`/trails/${id}/status`, { status }),
    onSuccess: (trail) => {
      queryClient.setQueryData(keys.trail(id), trail);
      invalidateTrails(id);
      toast(translate(trail.status === 'published' ? 'trails.published' : 'trails.savedDraft'));
    },
    onError: failed,
  });
}

export function useDeleteTrail() {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/trails/${id}`),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: keys.trail(id) });
      invalidateTrails();
      toast(translate('trails.deleted'));
    },
    onError: failed,
  });
}

/** Appends a paper to one of my trails (Add to a trail). */
export function useAppendToTrail() {
  return useMutation({
    mutationFn: async ({ trailId, paperId }: { trailId: string; paperId: string }) => {
      const trail = await api.get<TrailDetail>(`/trails/${trailId}`);
      const items = trail.steps.map((step) => ({ paper_id: step.paper.id, note: step.note }));
      return api.put<TrailDetail>(`/trails/${trailId}/items`, { items: [...items, { paper_id: paperId, note: null }] });
    },
    onSuccess: (trail) => {
      queryClient.setQueryData(keys.trail(trail.id), trail);
      invalidateTrails(trail.id);
      toast(translate('att.added', { title: trail.title }));
    },
    onError: failed,
  });
}

// ---------- Reports ----------

export function useReport() {
  return useMutation({
    mutationFn: (input: { target_type: ReportTargetType; target_id: string; reason: ReportReason }) => api.post('/reports', input),
    onSuccess: () => toast(translate('report.sent')),
    onError: failed,
  });
}
