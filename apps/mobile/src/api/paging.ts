import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './client';
import type { Page } from './types';

type Query = Record<string, string | number | boolean | undefined>;

/**
 * A cursor-paged list. Items are flattened; `loadMore` is safe to call from onEndReached at any
 * time (it does nothing while a page is loading or when there are no more pages).
 */
export function useCursorList<T>(key: QueryKey, path: string, query: Query = {}, options: { enabled?: boolean; persist?: boolean; limit?: number } = {}) {
  const result = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => api.get<Page<T>>(path, { ...query, limit: options.limit ?? 20, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: options.enabled,
    meta: options.persist ? { persist: true } : undefined,
  });
  const items = useMemo(() => result.data?.pages.flatMap((page) => page.items) ?? [], [result.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = result;
  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  };
  return { ...result, items, loadMore };
}
