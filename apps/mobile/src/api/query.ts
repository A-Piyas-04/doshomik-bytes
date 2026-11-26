import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';
import { ApiError } from './client';

/**
 * The query cache. Slow, flaky networks are the normal case: data is cached and revalidated in the
 * background, a few screens are persisted so the second open shows content before the network
 * answers, and failures retry twice except for client errors.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60_000,
      retry: (failures, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failures < 2;
      },
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

/** Keeps only the first page of an infinite list: enough to show content before the network answers. */
function firstPageOnly(data: unknown): unknown {
  if (data && typeof data === 'object' && 'pages' in data && 'pageParams' in data) {
    const infinite = data as { pages: unknown[]; pageParams: unknown[] };
    return { pages: infinite.pages.slice(0, 1), pageParams: infinite.pageParams.slice(0, 1) };
  }
  return data;
}

/** Only queries marked `meta: { persist: true }` go to disk, and only their first page. */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'query-cache:v1',
  throttleTime: 1000,
  serialize: (client) =>
    JSON.stringify({
      ...client,
      clientState: {
        ...client.clientState,
        queries: client.clientState.queries.map((query) => ({ ...query, state: { ...query.state, data: firstPageOnly(query.state.data) } })),
      },
    }),
});

export const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60_000,
  buster: String(Constants.expoConfig?.version ?? '0'),
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { meta?: Record<string, unknown>; state: { status: string } }) =>
      query.meta?.persist === true && query.state.status === 'success',
  },
};

/**
 * Refetch on app focus (AppState), and pause queries while offline (expo-network). `onlineManager`
 * is the app's one source for "online": the offline banner reads it too. On web, TanStack's own
 * browser online/offline listener drives it.
 */
export function wireQueryManagers(): () => void {
  const appState = AppState.addEventListener('change', (status) => {
    if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
  });
  if (Platform.OS === 'web') return () => appState.remove();

  const apply = (state: Network.NetworkState) => onlineManager.setOnline(state.isConnected !== false && state.isInternetReachable !== false);
  // The listener only reports changes, so read the state once: a cold start without a
  // connection must count as offline.
  let heard = false;
  const network = Network.addNetworkStateListener((state) => {
    heard = true;
    apply(state);
  });
  Network.getNetworkStateAsync()
    .then((state) => {
      if (!heard) apply(state);
    })
    .catch(() => undefined);
  return () => {
    appState.remove();
    network.remove();
  };
}

/** Query keys in one place, so mutations invalidate exactly what they change. */
export const keys = {
  me: ['me'] as const,
  interests: ['me', 'interests'] as const,
  fields: ['fields'] as const,
  topics: (field?: string) => ['topics', field ?? 'all'] as const,
  topic: (slug: string) => ['topic', slug] as const,
  unread: ['notifications', 'unread'] as const,
  notifications: ['notifications', 'list'] as const,
  followRequests: ['me', 'follow-requests'] as const,
  feed: ['feed'] as const,
  suggestions: ['users', 'suggestions'] as const,
  reels: ['reels'] as const,
  explore: (field?: string) => ['explore', field ?? 'all'] as const,
  post: (id: string) => ['post', id] as const,
  comments: (kind: 'posts' | 'papers', id: string) => ['comments', kind, id] as const,
  replies: (commentId: string) => ['replies', commentId] as const,
  user: (id: string) => ['user', id] as const,
  userPosts: (id: string) => ['user', id, 'posts'] as const,
  userReading: (id: string) => ['user', id, 'reading'] as const,
  userTrails: (id: string) => ['user', id, 'trails'] as const,
  savedPosts: ['me', 'saved'] as const,
  blocks: ['me', 'blocks'] as const,
  // Research
  papers: (filter: { field?: string; q?: string; sort?: string; interests?: boolean }) => ['papers', filter] as const,
  paper: (id: string) => ['paper', id] as const,
  learnFirst: (id: string) => ['paper', id, 'learn-first'] as const,
  lineage: (id: string, limit: number) => ['paper', id, 'lineage', limit] as const,
  related: (id: string) => ['paper', id, 'related'] as const,
  upNext: ['me', 'papers', 'up-next'] as const,
  myPapers: (list: 'saved' | 'read') => ['me', 'papers', list] as const,
  readingStats: ['me', 'reading', 'stats'] as const,
  roadmap: (field: string) => ['roadmap', field] as const,
  trails: (field?: string) => ['trails', field ?? 'all'] as const,
  trail: (id: string) => ['trail', id] as const,
  // Learn
  courses: (field?: string) => ['courses', field ?? 'all'] as const,
  myCourses: ['me', 'courses'] as const,
  course: (id: string) => ['course', id] as const,
  learnItems: (filter: { field?: string; topic?: string }) => ['learn-items', filter] as const,
  learnItem: (id: string) => ['learn-item', id] as const,
  quizzes: (filter: { field?: string; topic?: string }) => ['quizzes', filter] as const,
  quiz: (id: string) => ['quiz', id] as const,
  practiceStats: ['me', 'practice', 'stats'] as const,
  practiceHistory: ['me', 'practice', 'history'] as const,
  // Search
  search: (q: string, type?: string) => ['search', q, type ?? 'top'] as const,
  suggest: (q: string) => ['search', 'suggest', q] as const,
};
