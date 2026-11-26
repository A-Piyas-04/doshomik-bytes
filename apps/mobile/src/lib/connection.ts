import { onlineManager } from '@tanstack/react-query';
import { create } from 'zustand';

/** A phone switching networks drops out for a moment; only a real outage shows the strip. */
const SHOW_AFTER_MS = 1500;
/** How long "Back online" stays before the strip goes. */
const BACK_ONLINE_MS = 2500;

/** What the offline strip above the tab bar shows. */
export type ConnectionPhase = 'hidden' | 'offline' | 'back';

/**
 * Hidden, offline, or briefly "back online" after an outage. Derived from TanStack's
 * `onlineManager` (fed by expo-network in `api/query.ts`), the same signal that pauses queries, so
 * the strip and the data layer never disagree. The toast reads it to sit above the strip.
 */
export const useConnectionPhase = create<{ phase: ConnectionPhase }>(() => ({ phase: 'hidden' }));

const setPhase = (next: ConnectionPhase | ((current: ConnectionPhase) => ConnectionPhase)) =>
  useConnectionPhase.setState((s) => ({ phase: typeof next === 'function' ? next(s.phase) : next }));

/** Starts following `onlineManager`. Called once from the root layout; returns the cleanup. */
export function wireConnectionPhase(): () => void {
  // Already offline (after a fast refresh, say): show the strip at once, there is no blip to wait out.
  setPhase(onlineManager.isOnline() ? 'hidden' : 'offline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = onlineManager.subscribe((online) => {
    clearTimeout(timer);
    if (online) {
      // Only an outage the user saw earns a "Back online".
      setPhase((current) => (current === 'offline' ? 'back' : current));
      timer = setTimeout(() => setPhase('hidden'), BACK_ONLINE_MS);
    } else {
      setPhase((current) => (current === 'back' ? 'hidden' : current));
      timer = setTimeout(() => setPhase('offline'), SHOW_AFTER_MS);
    }
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
