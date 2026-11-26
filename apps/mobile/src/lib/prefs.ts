import { getLocales } from 'expo-localization';
import { create } from 'zustand';
import { storage } from './storage';

/**
 * Device preferences. There is no language column on the server (no `users.locale`), so the
 * language lives here, with the theme and a few remembered choices. Loaded once by the app loader
 * (`loadPrefs`) and written back on every change.
 */
export type Lang = 'en' | 'bn';
export type ThemePreference = 'dark' | 'light' | 'system';
export type HomePane = 'feed' | 'research';
export type DevUser = 'admin' | 'learner1' | 'learner2';

interface Prefs {
  lang: Lang;
  theme: ThemePreference;
  homePane: HomePane;
  /** Development only: which seeded account the API should act as (x-dev-user). */
  devUser: DevUser | null;
  /** Recent Explore searches, newest first. */
  recentSearches: string[];
  /** Recent Research paper searches, newest first. */
  recentPaperSearches: string[];
}

interface PrefsStore extends Prefs {
  hydrated: boolean;
  set: (changes: Partial<Prefs>) => void;
  rememberSearch: (kind: 'recentSearches' | 'recentPaperSearches', query: string) => void;
  forgetSearches: (kind: 'recentSearches' | 'recentPaperSearches') => void;
}

const KEY = 'prefs:v1';
const RECENT_LIMIT = 8;

function deviceLang(): Lang {
  try {
    return getLocales()[0]?.languageCode === 'bn' ? 'bn' : 'en';
  } catch {
    return 'en';
  }
}

const defaults = (): Prefs => ({
  lang: deviceLang(),
  theme: 'light', // the owner's colour theme is light-first; dark is a full alternative
  homePane: 'feed',
  devUser: null,
  recentSearches: [],
  recentPaperSearches: [],
});

function persisted(state: PrefsStore): Prefs {
  const { lang, theme, homePane, devUser, recentSearches, recentPaperSearches } = state;
  return { lang, theme, homePane, devUser, recentSearches, recentPaperSearches };
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  ...defaults(),
  hydrated: false,
  set: (changes) => {
    set(changes);
    void storage.set(KEY, persisted(get()));
  },
  rememberSearch: (kind, query) => {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...get()[kind].filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_LIMIT);
    get().set({ [kind]: next });
  },
  forgetSearches: (kind) => get().set({ [kind]: [] }),
}));

export async function loadPrefs(): Promise<void> {
  const saved = await storage.get<Partial<Prefs>>(KEY);
  usePrefs.setState({ ...defaults(), ...(saved ?? {}), hydrated: true });
}

/** Read outside React (the API client). */
export const getPrefs = () => usePrefs.getState();
