import type { QueryKey } from '@tanstack/react-query';
import { queryClient } from './query';

type Snapshot = [QueryKey, unknown][];

/**
 * Applies `patch` to every cached object with this `id` that has `marker` as a key (for example
 * every PaperCard with id X that carries `saved_by_me`), in every query: lists, infinite pages,
 * roadmaps, trails, lineage, details. Returns what it replaced, so a failed request can roll back.
 */
export function patchEverywhere<T extends object>(id: string, marker: keyof T & string, patch: Partial<T>): Snapshot {
  const changed: Snapshot = [];
  for (const query of queryClient.getQueryCache().getAll()) {
    const before = query.state.data;
    if (before === undefined) continue;
    const after = patchDeep(before, id, marker, patch as Record<string, unknown>);
    if (after !== before) {
      changed.push([query.queryKey, before]);
      queryClient.setQueryData(query.queryKey, after);
    }
  }
  return changed;
}

export function restore(snapshot: Snapshot): void {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

function patchDeep(value: unknown, id: string, marker: string, patch: Record<string, unknown>, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const patched = patchDeep(item, id, marker, patch, depth + 1);
      if (patched !== item) changed = true;
      return patched;
    });
    return changed ? next : value;
  }
  const record = value as Record<string, unknown>;
  let result: Record<string, unknown> | null = null;
  if (record.id === id && marker in record) result = { ...record, ...patch };
  for (const [key, child] of Object.entries(result ?? record)) {
    if (child === null || typeof child !== 'object') continue;
    const patched = patchDeep(child, id, marker, patch, depth + 1);
    if (patched !== child) {
      result = result ?? { ...record };
      result[key] = patched;
    }
  }
  return result ?? value;
}
