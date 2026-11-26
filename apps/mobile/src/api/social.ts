import { useMutation, useQuery } from '@tanstack/react-query';
import { translate } from '@/i18n';
import { tick } from '@/lib/haptics';
import { toast } from '@/ui/Toast';
import { patchEverywhere, restore } from './cache';
import { api } from './client';
import { useCursorList } from './paging';
import { keys, queryClient } from './query';
import type { Account, Comment, FollowRequest, Notification, Post, Profile, Suggestion, UserSummary } from './types';

const failed = () => toast(translate('common.actionFailed'), { tone: 'error' });

// ---------- Me ----------

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) => api.get<Account>('/me', undefined, signal),
    staleTime: 5 * 60_000,
    meta: { persist: true },
  });
}

export function useUpdateMe() {
  return useMutation({
    mutationFn: (changes: { display_name?: string | null; bio?: string | null; is_private?: boolean }) => api.patch<Account>('/me', changes),
    onSuccess: (account) => {
      queryClient.setQueryData(keys.me, account);
      void queryClient.invalidateQueries({ queryKey: keys.user(account.id) });
    },
    onError: failed,
  });
}

// ---------- Posts ----------

export const useFeed = () => useCursorList<Post>(keys.feed, '/feed', {}, { persist: true });
export const useReels = () => useCursorList<Post>(keys.reels, '/reels', {}, { limit: 10 });
export const useExplore = (field?: string) => useCursorList<Post>(keys.explore(field), '/explore', { field }, { limit: 30 });
export const useUserPosts = (userId: string | undefined) =>
  useCursorList<Post>(keys.userPosts(userId ?? ''), `/users/${userId}/posts`, {}, { enabled: !!userId, limit: 30 });
export const useSavedPosts = () => useCursorList<Post>(keys.savedPosts, '/me/saved', {}, { limit: 30 });

export function usePost(id: string) {
  return useQuery({ queryKey: keys.post(id), queryFn: ({ signal }) => api.get<Post>(`/posts/${id}`, undefined, signal) });
}

/** Like or unlike, everywhere at once (the count is kept by the worker, so it is shown optimistically). */
export function useToggleLike() {
  return useMutation({
    mutationFn: ({ post, like }: { post: Pick<Post, 'id'>; like: boolean }) => (like ? api.put(`/posts/${post.id}/like`) : api.delete(`/posts/${post.id}/like`)),
    onMutate: ({ post, like }) => {
      if (like) tick();
      const current = findPost(post.id);
      const count = current ? Math.max(0, current.like_count + (like ? 1 : -1)) : undefined;
      return patchEverywhere<Post>(post.id, 'liked_by_me', count === undefined ? { liked_by_me: like } : { liked_by_me: like, like_count: count });
    },
    onError: (_, __, snapshot) => {
      if (snapshot) restore(snapshot);
      failed();
    },
  });
}

export function useToggleSavePost() {
  return useMutation({
    mutationFn: ({ id, save }: { id: string; save: boolean }) => (save ? api.put(`/posts/${id}/save`) : api.delete(`/posts/${id}/save`)),
    onMutate: ({ id, save }) => patchEverywhere<Post>(id, 'saved_by_me', { saved_by_me: save }),
    onSuccess: (_, { save }) => {
      if (save) toast(translate('post.saved'));
      void queryClient.invalidateQueries({ queryKey: keys.savedPosts });
    },
    onError: (_, __, snapshot) => {
      if (snapshot) restore(snapshot);
      failed();
    },
  });
}

export function useDeletePost() {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/posts/${id}`),
    onSuccess: () => {
      toast(translate('post.deleted'));
      for (const key of [keys.feed, keys.reels, ['explore'], ['user']]) void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: failed,
  });
}

/** The newest copy of a post anywhere in the cache (for optimistic counts). */
function findPost(id: string): Post | undefined {
  for (const query of queryClient.getQueryCache().getAll()) {
    const found = searchPost(query.state.data, id, 0);
    if (found) return found;
  }
  return undefined;
}

function searchPost(value: unknown, id: string, depth: number): Post | undefined {
  if (depth > 6 || value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = searchPost(item, id, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.id === id && 'liked_by_me' in record) return record as unknown as Post;
  for (const child of Object.values(record)) {
    const hit = searchPost(child, id, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

// ---------- Comments (post comments and paper discussion share one shape) ----------

export type Thread = { kind: 'posts' | 'papers'; id: string };

export const useComments = (thread: Thread) => useCursorList<Comment>(keys.comments(thread.kind, thread.id), `/${thread.kind}/${thread.id}/comments`, {}, { limit: 30 });

export const useReplies = (commentId: string, enabled: boolean) =>
  useCursorList<Comment>(keys.replies(commentId), `/comments/${commentId}/replies`, {}, { enabled, limit: 30 });

export function useAddComment(thread: Thread) {
  return useMutation({
    mutationFn: ({ body, parentId }: { body: string; parentId?: string }) =>
      api.post<Comment>(`/${thread.kind}/${thread.id}/comments`, { body, parent_id: parentId }),
    onSuccess: (comment) => {
      if (comment.parent_id) void queryClient.invalidateQueries({ queryKey: keys.replies(comment.parent_id) });
      void queryClient.invalidateQueries({ queryKey: keys.comments(thread.kind, thread.id) });
      if (thread.kind === 'posts') {
        const post = findPost(thread.id);
        if (post) patchEverywhere<Post>(thread.id, 'liked_by_me', { comment_count: post.comment_count + 1 });
      }
    },
    onError: failed,
  });
}

export function useDeleteComment(thread: Thread) {
  return useMutation({
    mutationFn: (comment: Comment) => api.delete(`/comments/${comment.id}`),
    onSuccess: (_, comment) => {
      toast(translate('comments.deleted'));
      if (comment.parent_id) void queryClient.invalidateQueries({ queryKey: keys.replies(comment.parent_id) });
      void queryClient.invalidateQueries({ queryKey: keys.comments(thread.kind, thread.id) });
    },
    onError: failed,
  });
}

// ---------- People ----------

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: keys.user(id ?? ''),
    queryFn: ({ signal }) => api.get<Profile>(`/users/${id}`, undefined, signal),
    enabled: !!id,
  });
}

export function useSuggestions(enabled = true) {
  return useQuery({
    queryKey: keys.suggestions,
    queryFn: ({ signal }) => api.get<{ items: Suggestion[] }>('/users/suggestions', { limit: 10 }, signal).then((r) => r.items),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/** Follow (accepted at once, or pending for a private account) or unfollow, optimistically. */
export function useFollow() {
  return useMutation({
    mutationFn: async ({ user, follow }: { user: Pick<UserSummary, 'id'>; follow: boolean; isPrivate?: boolean }) =>
      follow ? api.put<{ status: 'accepted' | 'pending' }>(`/users/${user.id}/follow`) : api.delete(`/users/${user.id}/follow`).then(() => ({ status: 'none' as const })),
    onMutate: ({ user, follow, isPrivate }) => {
      if (follow) tick();
      const previous = queryClient.getQueryData<Profile>(keys.user(user.id));
      if (previous) {
        const status = follow ? (isPrivate ? 'pending' : 'accepted') : 'none';
        const delta = (status === 'accepted' ? 1 : 0) - (previous.follow_status === 'accepted' ? 1 : 0);
        queryClient.setQueryData<Profile>(keys.user(user.id), { ...previous, follow_status: status, followers_count: previous.followers_count + delta });
      }
      return previous;
    },
    onSuccess: (result, { user }) => {
      queryClient.setQueryData<Profile>(keys.user(user.id), (profile) => (profile ? { ...profile, follow_status: result.status } : profile));
      // The guess in onMutate may have been wrong (an account that went private): recount from the server.
      void queryClient.invalidateQueries({ queryKey: keys.user(user.id), exact: true });
      void queryClient.invalidateQueries({ queryKey: keys.feed });
      void queryClient.invalidateQueries({ queryKey: keys.suggestions });
    },
    onError: (_, { user }, previous) => {
      if (previous) queryClient.setQueryData(keys.user(user.id), previous);
      failed();
    },
  });
}

export function useBlock() {
  return useMutation({
    mutationFn: ({ userId, block }: { userId: string; block: boolean }) => (block ? api.put(`/users/${userId}/block`) : api.delete(`/users/${userId}/block`)),
    onSuccess: (_, { block }) => {
      if (block) toast(translate('profile.blocked'));
      void queryClient.invalidateQueries();
    },
    onError: failed,
  });
}

export const useBlocks = () => useCursorList<{ user: UserSummary; blocked_at: string }>(keys.blocks, '/me/blocks');

// ---------- Notifications ----------

export function useUnreadCount() {
  return useQuery({
    queryKey: keys.unread,
    queryFn: ({ signal }) => api.get<{ count: number }>('/notifications/unread-count', undefined, signal).then((r) => r.count),
    refetchInterval: 60_000,
  });
}

export const useNotifications = () => useCursorList<Notification>(keys.notifications, '/notifications', {}, { limit: 30 });
export const useFollowRequests = () => useCursorList<FollowRequest>(keys.followRequests, '/me/follow-requests');

export function useMarkNotificationRead() {
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onMutate: (id) => {
      patchEverywhere<Notification>(id, 'is_read', { is_read: true });
      queryClient.setQueryData<number>(keys.unread, (count) => Math.max(0, (count ?? 1) - 1));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.unread }),
  });
}

export function useAnswerFollowRequest() {
  return useMutation({
    mutationFn: ({ userId, accept }: { userId: string; accept: boolean }) =>
      accept ? api.post(`/me/follow-requests/${userId}/accept`) : api.delete(`/me/follow-requests/${userId}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.followRequests });
      void queryClient.invalidateQueries({ queryKey: keys.me });
    },
    onError: failed,
  });
}
