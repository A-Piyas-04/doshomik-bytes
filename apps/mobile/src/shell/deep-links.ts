/**
 * Rewrites links that open the app (custom scheme, Android App Links, notification taps) before
 * Expo Router resolves them. Used by `src/app/+native-intent.tsx`; kept here, free of native
 * imports, so it can be tested on its own.
 *
 * Two jobs:
 *
 * 1. **Share links → app routes.** The API's `share_url`s are `/p/:id`, `/papers/:id` and
 *    `/courses/:id` (short, and they also work as web fallbacks). The app routes are
 *    `/post/[id]`, `/paper/[id]` and `/course/[id]`.
 *
 * 2. **Cold starts → the right tab.** Shared screens exist in every tab's stack
 *    (`(tabs)/(home,learn,explore,reels,profile)/`). A path like `/paper/123` matches all five,
 *    and without a current tab Expo Router takes the first in its sort order (Explore). On a cold
 *    start the link is pinned to the tab the content belongs to, so Back lands somewhere that
 *    makes sense (a paper → Home, which holds Research; a lesson → Learn). While the app is
 *    running, links stay unpinned and open in the current tab, like any in-app push.
 */

type Tab = '(home)' | '(learn)' | '(profile)';

/** The tab a shared screen opens in on a cold start, by the route's first segment. */
const HOME_TAB: Record<string, Tab> = {
  // Research lives in Home.
  paper: '(home)',
  'paper-search': '(home)',
  roadmaps: '(home)',
  trails: '(home)',
  trail: '(home)',
  library: '(home)',
  // Social.
  post: '(home)',
  comments: '(home)',
  user: '(home)',
  notifications: '(home)',
  // Learn, with Practice inside it.
  course: '(learn)',
  lesson: '(learn)',
  practice: '(learn)',
  topic: '(learn)',
  settings: '(profile)',
};

/** Share-link prefixes (from the API's `share_url`) and the app route each one means. */
const SHARE_PREFIX: Record<string, string> = { p: 'post', papers: 'paper', courses: 'course' };

/** Splits a URL or path into percent-encoded path segments and the `?query#hash` tail. */
function splitUrl(url: string): { segments: string[]; tail: string } {
  let rest: string;
  const web = /^https?:\/\/[^/?#]*(.*)$/i.exec(url);
  if (web) {
    rest = web[1] ?? '';
  } else {
    // A custom scheme (`doshomikbytes://paper/1`): everything after `://` is the path, host included.
    const custom = /^[a-z][a-z0-9+.-]*:\/\/(.*)$/i.exec(url);
    rest = custom ? (custom[1] ?? '') : url;
  }
  // Dev-server URLs put the route after `/--/`.
  rest = rest.replace(/^\/?--(?=[/?#]|$)/, '');
  const cut = rest.search(/[?#]/);
  const pathname = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? '' : rest.slice(cut);
  return { segments: pathname.split('/').filter(Boolean), tail };
}

/**
 * The path to open instead of `url`, or null to leave the link alone. `url` must already be
 * unwrapped from a dev-client launch URL.
 */
export function rewriteSystemPath(url: string, initial: boolean): string | null {
  if (!url) return null;
  const parts = splitUrl(url);
  let segments = parts.segments;
  let changed = false;

  const route = segments.length === 2 ? SHARE_PREFIX[segments[0]!] : undefined;
  if (route) {
    segments = [route, segments[1]!];
    changed = true;
  }

  const tab = initial ? HOME_TAB[segments[0] ?? ''] : undefined;
  if (tab) {
    segments = ['(tabs)', tab, ...segments];
    changed = true;
  }

  return changed ? `/${segments.join('/')}${parts.tail}` : null;
}
