import { useCallback } from 'react';
import { usePrefs, type Lang } from '@/lib/prefs';
import { bn } from './bn';
import { en, type MessageKey } from './en';

export type { MessageKey } from './en';

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, bn };

type Vars = Record<string, string | number>;

function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Translate outside React (toasts fired from mutations). */
export function translate(key: MessageKey, vars?: Vars, lang: Lang = usePrefs.getState().lang): string {
  return format(dictionaries[lang][key] ?? en[key], vars);
}

/** `t('post.likes', { n: 3 })`. Re-renders when the language changes. */
export function useT() {
  const lang = usePrefs((s) => s.lang);
  return useCallback((key: MessageKey, vars?: Vars) => format(dictionaries[lang][key] ?? en[key], vars), [lang]);
}

export function useLang(): Lang {
  return usePrefs((s) => s.lang);
}

// ---------- Numbers and times: always Western digits ----------

/** 999 → "999", 1234 → "1.2k", 1_250_000 → "1.3M". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim(n / 1000)}k`;
  return `${trim(n / 1_000_000)}M`;
}

const trim = (value: number) => (value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, ''));

/** "now", "5m", "3h", "2d", "4w", then a short date. */
export function relativeTime(iso: string, lang: Lang): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return translate('time.now', undefined, lang);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return translate('time.minutes', { n: minutes }, lang);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate('time.hours', { n: hours }, lang);
  const days = Math.floor(hours / 24);
  if (days < 7) return translate('time.days', { n: days }, lang);
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return translate('time.weeks', { n: weeks }, lang);
  return shortDate(iso, lang);
}

const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  bn: ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুলা', 'আগ', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'],
};

/** "12 Mar 2026" with Western digits in both languages (Hermes Intl support for bn is uneven). */
export function shortDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = `${date.getDate()} ${MONTHS[lang][date.getMonth()]}`;
  return sameYear ? day : `${day} ${date.getFullYear()}`;
}
