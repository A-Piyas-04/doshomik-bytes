# Mobile frontend: implementation notes

The record of how the Expo app (`apps/mobile`) was built from the owner's brief of 26 Nov 2026: what was decided and why, what was deferred, and how to finish it. Backend changes made for the app are in [`prototype-2-implementation-notes.md` §2.10](prototype-2-implementation-notes.md#210-backend-support-for-the-mobile-app-migration-007-26-nov-2026).

## Contents

1. [The brief](#1-the-brief)
2. [Decisions](#2-decisions)
3. [The Research design](#3-the-research-design)
4. [How the app is built](#4-how-the-app-is-built)
5. [Verification](#5-verification)
6. [Deferred and follow-up work](#6-deferred-and-follow-up-work)
7. [Known limitations](#7-known-limitations)

---

## 1. The brief

- **Loading screen:** the square mark and the wordmark.
- **Shell:** Instagram-like. The Home header has Create (+) on the left, the wordmark in the middle, and the EN/বাং switch and Notifications on the right.
- **Bottom tabs:** Home · Learn · Explore · Reels · Profile.
- **Home:** two sub-tabs under the header, **Feed | Research**.
- **Learn:** our courses and free outside ones (YouTube, Coursera and others) for five areas: ML fundamentals, Deep learning, Computer vision, Transformers, LLMs. It has a **Practice** button.
- **Explore:** Instagram-like, with sub-tabs suited to research and learning.
- **Reels:** the reel posts.
- **Research:** designed from the backend. It must cover every built research feature with few choices per view and a clear flow.
- **Later the same day:**
  - The owner sent two mockups with the instruction "follow this colour theme".
  - The owner restated the design rules: no glass, gradients, glows, pills, card-in-card, accent stripes or repeated oversized cards.
- **Owner's rules for this build:**
  - Don't ask; decide and record.
  - No git.
  - Auth comes last.
  - Production-grade.

## 2. Decisions

| Decision | Why | Consequence / later |
| --- | --- | --- |
| **Tabs: Home · Learn · Explore · Reels · Profile.** Practice lives in Learn, Research in Home, Search is the Explore tab | The owner's brief | It overrides the tab list in `project-context.md` §2.2 (updated) and in the Prototype docs (which are never edited). The mockups showed a different tab set (Reels/Learn/Practice/Research/Profile); the instruction was "colour theme", so the written brief's tabs stand |
| **Colour theme from the mockups, shapes from the design rules.** Details: light-first; warm grey page `#F3F4F1`; white surfaces; ink text; deep teal primary `#12755E`; mint washes; amber second accent; ink-filled selected chip; coral unread dot | "Follow this colour theme", plus the restated no-AI-slop rules | Light is the default theme; dark is a full alternative on the logo's ink. Radii: 14 for cards and colour blocks, 8 for buttons and chips, 4 for badges; no pills. All values are in `src/theme/tokens.ts`. Revised by the energy pass below |
| **Type:** Inter (UI), Noto Sans Bengali (every Bengali run), Source Serif 4 (paper titles and course titles), JetBrains Mono (labels, step numbers) | Research should read as "paper"; mono labels echo the slab "D" of the logo | `AppText` splits mixed strings into script runs, so "Transformer-এর attention" uses both fonts and Bangla gets a taller line height. Only the 13 weights used are bundled |
| **One taxonomy:** the five areas are `fields`, shared by every tab's chips | Learn needed areas; Research already had them | Backend migration `…007`. Area names have Bangla versions in `src/features/fields.tsx` (`fieldName`) for the five launch slugs |
| **Language lives on the device** (`prefs.lang`): it switches UI strings, the wordmark and the preferred Paper Card language | There is no `users.locale` on the server | Push and email text stay English (backend §4). Numbers are Western digits in both languages. Relative times and dates are written by hand (`src/i18n/index.ts`), because Hermes `Intl` is uneven for `bn` |
| **i18n:** a typed dictionary (`en.ts` is the source of keys; `bn.ts` must define all of them), not i18next | Small, no runtime cost, and a missing Bangla string fails typecheck | Plurals are separate keys where English needs them |
| **Auth is not built.** The client sends no Authorization header; in development, Settings has an "Act as" switch (admin / learner1 / learner2) that sets `x-dev-user` | The owner's "auth last" rule; the API runs with `DEV_AUTH_BYPASS` | Before release, see §6: sign-in screens, the token store (`expo-secure-store` is already installed), refresh-on-401 in `src/api/client.ts`, logout, delete account |
| **Routing:** custom JS tabs (`expo-router/js-tabs`), a stack per tab, shared screens in the array group `(tabs)/(home,learn,explore,reels,profile)/` | Per-tab back history like Instagram, and a branded tab bar (labels, amber dot) that native tabs can't draw | Every tab layout exports `unstable_settings.anchor` (required since SDK 58.0.26). Create, trail editor, edit profile, the reel viewer and the image viewer are root screens over the tabs |
| **The tab bar stays on Reels** | Hiding it left the tab without a way out | The single-reel viewer (`/reel/[id]`) is full screen with a Back button |
| **Sheets are RN `Modal`s** (`ui/BottomSheet`, `ui/ActionSheet`), not form-sheet routes | Form sheets on Android can hide the input behind the keyboard and can't change height reliably. A Modal behaves the same on Android, iOS and the web build used for QA | `confirm()` replaces `Alert` (which does nothing on web). Comments are a pushed screen with the composer pinned above the keyboard, rather than a sheet |
| **Optimistic updates everywhere it matters:** like, save (post and paper), follow, reading step | Spec §2.5 | `src/api/cache.ts` patches the object in every cached list and detail, and restores it with a toast if the request fails |
| **Course steps are walked on the lesson screen** (Previous · 3 of 8 · Next) | The stepper belongs where the reading happens | Next records `PUT /courses/:id/progress`, which also marks those lessons done for Learn first |
| **Uploads continue in the background** (`features/create/uploads.ts`): the create screen closes at once; a banner above the tab bar shows progress, processing, live or failed (with Retry) | Spec: keep browsing while a reel processes | Native uploads use the `expo-file-system` upload task; web uses XHR. Images over 2048 px are resized to JPEG before upload. A reel over 90 s is rejected when picked; the server checks again |
| **Explore:** a search box for everything; while idle, a discovery page (area chips; for a chosen area, a spotlight in its colour with Roadmap and Practice; Trending in research; Learn something new; then a mosaic of posts); suggestions while typing; results in Top · Papers · Learn · People · Posts | "Instagram-like, with research and learning sub-tabs", then "the dullest Explore page ever" | The area lives in the URL (`/explore?area=deep-learning`), so the feed's area circles open Explore on that area. The mosaic is blocks of three; every other block is led by a big tile (a reel first, then an image), alternating sides. Pages are 30 posts, so loading more never reshuffles what is on screen |
| **Energy pass** (owner feedback, 26 Nov 2026: "boring, dull, unenergetic… fonts too big… no distinction between sections… Instagram formula, not LinkedIn") | The first build followed the restraint rules too literally: one accent, rows on one surface, large type | Changes:<br>• **Area colours.** Each of the five areas has a vivid colour (`AreaColor` in `tokens.ts`, `useArea` in `theme/area.ts`, `AreaGlyph` in `features/fields.tsx`), used on chips, badges, the feed's area circles, colour blocks, tiles, course covers and the paper and roadmap headers. Avatars without a photo get a per-person colour.<br>• **Compact type with real steps.** The type scale drops a size, and a post shows the username, the topic line and the text at three distinct levels.<br>• **Separation.** Papers and courses are white cards with visible borders and gaps; feed posts are full-width cards split by grey bands.<br>• **Feed.** A rail of area circles where stories would be. Short text posts sit on their area's colour; longer ones read as text with "more"; counts sit beside the icons.<br>• **Research.** Roadmaps and Trails are solid tiles; the paper screen's header takes its area's colour.<br>• **Learn.** A Continue card, a Start practice banner, carousels of our courses and free courses (`CourseCard`), and lessons grouped in cards with area-tinted icons.<br>• **Explore.** The discovery page above.<br>• Still within the no-slop rules: solid fills only (no gradients, glass or glows), no pills, no card-in-card. The large faded area glyph on covers and headers is the one ornament, and it names the area.<br>• Backend: a topic reference now carries its area (`topic.field`, a slug or null) on posts and learn items, so the app can colour them without another request |
| **Deep links go through `src/app/+native-intent.tsx`** (rules in `src/shell/deep-links.ts`) | Expo Router's matcher sent a cold-start `/paper/:id` to the Explore stack: every shared screen exists in all five tabs, and with no current tab the first in sort order wins. Separately, the API's share links (`/p/:id`, `/papers/:id`, `/courses/:id`) matched no app route and opened "not found" | Share prefixes map to `/post`, `/paper` and `/course`. On a cold start the path is pinned to the content's tab (`/(tabs)/(home)/paper/:id`): research and social screens → Home, Learn and Practice screens → Learn, settings → Profile. Links that arrive while the app is running stay unpinned and open in the current tab, like any in-app push. Unknown URLs, unique routes (`/explore`, `/reel/:id`) and dev-client launch URLs pass through unchanged, and the handler never throws |
| **Lessons open in their real state:** `completed_by_me` from `GET /learn-items/:id` drives Mark as done / Done | The screen kept "done" in local state, so a finished lesson reopened as not done | Mark as done is optimistic (the cached item flips and is restored with a toast on failure). Saving course progress invalidates cached lessons, since the steps reached are now done |
| **Offline strip above the tab bar** (`shell/OfflineBanner.tsx`, state in `lib/connection.ts`) | Cached screens kept showing with no sign that they were stale | Ink strip "You're offline. Showing what was saved."; teal "Back online" for 2.5 s after an outage the user saw. Drops shorter than 1.5 s (switching networks) never show. It reads TanStack's `onlineManager`, the same signal that pauses queries, so the strip and the data never disagree. At startup the network state is read once, because expo-network's listener reports changes only. The strip takes its own space (not an overlay), and toasts move up above it while it shows. It lives in the tab bar, so full-screen screens (create, reel viewer, editors) don't show it; they have their own failure states (the upload banner's Retry, error states) |
| **No research outputs (AI maps) screen** | Nothing generates them yet (Group C isn't built) | When Group C lands: add "Maps" as a fourth Library tab, using the existing `/me/research-outputs` endpoints |
| **The legacy tracker endpoints are not used** (`/papers/:id/status`, `/users/:id/papers`) | Superseded by save + reading steps (Group A) | Profile › Research uses `/users/:id/reading` |
| **Fonts are loaded with `useFonts`** (not the config plugin) | Same family names on Android, iOS and web | The loading screen covers the load |
| **Loading screen:** native splash (the mark on ink), then the JS loader with the same mark and the wordmark rising in. It stays at least 900 ms on a cold start | The brief asks for a loading screen with both logos; without a minimum it would flash | The app mounts underneath, so deep links resolve during loading |
| **App icon, adaptive icon (foreground, background, monochrome), splash and favicon regenerated from `logo/`** | They were the Expo defaults | Generated with sharp. The monochrome layer is the glyph only |
| **Skills installed for this build** (project scope, `.claude/skills/`):<br>• Expo's official set<br>• `vercel-react-native-skills`<br>• `ux-heuristics`<br>• `ui-ux-pro-max`<br>• `mobile-app-ui-design` | The owner asked for the most useful frontend, mobile-UI and UX skills | Removed the bundle extras `ui-ux-pro-max` pulled in (banner-design, slides, brand, design, ui-styling, design-system): they are web, marketing or logo-generation tools, some calling outside AI APIs. `mobile-app-ui-design`'s advice on glows, glass and `rounded-3xl` is overridden by the owner's rules |

## 3. The Research design

The paper is the unit. Every screen answers one question and has one primary action; depth comes from tapping, never from crowding the first view.

```
Home › Research
  1. Library: exactly one row, chosen by where the user is:
       a saved, unread paper      → "Up next" (ink banner) → Paper
       has read papers             → "This month: 2 explored · 1 studied" → Library
       new, no fields picked       → "Pick the fields you care about" → interests sheet → Roadmap
       new, fields picked          → "Start the <field> roadmap" → Roadmap
  2. Reading paths: Roadmaps (staff, one per field) · Trails (made by people)
  3. Papers: area chips (For you appears when interests exist), Trending/Newest, search → list

Paper
  meta · serif title · authors · metrics · Abstract page / PDF / Code
  The question (EN | বাং when both cards exist) + "more questions"
  Before you read  ●●○○○ 2 of 5 ready  → Learn first
  [Summary | Connections | Discussion · n]   (sticky)
     Summary: Problem, Key idea, Method (numbered), Data, Findings, Evaluation, Figures (zoom),
              Limitations, Takeaway, Glossary (expand), Original abstract (collapsed), AI note
     Connections: Builds on · Built on by (intent, influential; Show more) · Similar papers
     Discussion: first comments → the full thread
  Bottom bar: Open paper ↗ (primary) · ○○○ Mark read  →  ●○○ Explored → Reading sheet
  ⋯ menu: Your reading · Add to a trail · Share · Copy link

Learn first   dot meter, "We have lessons for 4 of 5 concepts", one row per concept:
              why it matters, one link (Lesson · 4 min / Note · 2 min / Quiz · 3 questions / Reel · 45 s),
              "I already know this" (Undo). Bottom: Open paper (primary once ready).
Reading sheet Explored → Studied → Reproduced stepper with meanings and dates, "Not started",
              private note (400 characters).
Roadmaps      one screen: area chips, then the timeline (01, 02 …, "Next" on the first unread, the note).
Trails        area chips, rows (title, description, by @user · n papers, বাংলা tag), New trail.
Trail         description, creator, timeline with the author's notes; owner: Edit, Publish/Unpublish,
              Delete; others: Report. Draft and removed banners.
Trail editor  title, description, language, area, papers with notes (up/down to reorder, remove),
              paper picker (saved first, then search). Save draft any time; Publish needs 2 papers.
Library       this month / all time counts; Saved · Read · My trails.
```

The reading dots `○○○ ●○○ ●●○ ●●●` reuse the logo's dot. Labels always come with them, so colour never carries the meaning alone.

**Every Group A feature has a place:**

| Feature | Where it appears |
| --- | --- |
| Collection, chips and trend order (A1, A10) | Research › Papers |
| Search (A2) | Research search; Explore |
| Save (A3) | Row and paper bookmarks |
| Steps and note (A4) | Bottom bar, Reading sheet |
| My papers and stats (A5) | Library; Profile › Research |
| Lineage (A6) | Connections |
| Trails (A7) | Trails, Trail, editor, Add to a trail, report |
| Discussion (A9) | Discussion tab, Comments |
| Learn before reading (A13) | Learn first, plus "Mark as done" on lessons and quizzes |
| Related papers | Connections |
| Roadmaps | Roadmaps |
| Interests | Library row, Settings |

## 4. How the app is built

| Layer | Where | Notes |
| --- | --- | --- |
| Routes | `src/app/` | Routes only. Shared screens in `(tabs)/(home,learn,explore,reels,profile)/` |
| Screens | `src/features/<area>/` | research, learn, social, explore, reels, profile, create, home, viewer |
| UI primitives | `src/ui/` | `AppText`, `Button`, `IconButton`, `Chips`, `SegmentedTabs`, `BottomSheet`, `ActionSheet`, `Toast`, `Skeleton`, `States`, `TextField`, `ScreenHeader`, `Bits` (rows, labels, badges), icons |
| Theme | `src/theme/` | Tokens, type scale, fonts, `ThemeProvider` |
| Data | `src/api/` | Typed client, response types, TanStack Query hooks per area. Only queries marked `meta.persist` go to disk (first pages of feed, papers, fields, me…) |
| Shell | `src/shell/` | Loader, tab bar, tab stack, `nav.ts` (every route push in one place) |
| Device | `src/lib/` | Preferences (zustand + AsyncStorage), haptics, share and outside links, upload (native and web), script splitting |

Every list has its loading (a skeleton of the real layout), empty (icon, one line, one action), error (Retry) and end states. Lists use FlashList, except the reel pager (FlatList, at most 3 players).

## 5. Verification

- **Mobile:** `pnpm --filter @doshomik/mobile typecheck` and `expo lint` pass, with the React Compiler rules on.
- **Android bundle:** `expo export --platform android` builds the Hermes bundle (about 5.3 MB).
- **Web QA:** every screen was rendered in the web build at 390 × 844, in light and dark and in English and Bangla, against the seeded API.
- **Flows exercised in the browser:**
  - saving a paper;
  - setting a reading step;
  - answering a practice question;
  - posting to a paper discussion;
  - the new-user interests sheet;
  - the create menu;
  - the trail editor;
  - search with grouped results.
  - These caught two bugs, both fixed:
    - CORS blocked PUT, PATCH and DELETE for browser clients (backend §2.10);
    - the field name wasn't localised in paper rows.
- **API:** all 65 tests pass, and typecheck passes (including after the `topic.field` addition).
- **Energy pass QA:** every changed screen was re-rendered and reviewed (feed, research, paper, Learn, Explore idle and with an area, library, roadmaps, profile; light and dark). It caught:
  - topic badges wrapping beside the username (moved into the line under the name);
  - area names cut off under the feed's circles;
  - text in small Explore tiles showing past its ellipsis on web (line clamp inside a stretched box);
  - a React Compiler error from picking a glyph component during render (now `AreaGlyph`).
- **QA tooling note:** start the web build for QA without `CI=1`. It turns off Metro's file watching, so edits silently don't reach the browser.
- **Code review** of the whole diff (medium effort). Fixed:
  - Upload retry could post twice. Jobs now carry an id, the media id and the post id: Retry resumes after the last step that succeeded, deletes a post stuck on failed media, and a dismissed job can't overwrite a newer one.
  - The processing wait could hang without end; it now fails clearly after about five minutes.
  - The client could hang on a body that stalled mid-response, and threw raw parse errors on proxy error pages.
  - Already-aborted requests are respected.
  - The follower count is refetched after a follow.
  - Only the first page of each persisted list is written to disk.
  - The seed's sample data no longer depends on the admin being named `admin`.
  - Left as is, on purpose: an unknown area slug in a list filter returns an empty list (asserted in `test/learn-areas.test.ts`).
- **Quick fixes (26 Nov 2026: deep links, lesson state, offline strip):**
  - Mobile typecheck, `expo lint` and `expo export --platform android` pass. The bundle includes the native-intent handler.
  - All 65 API tests pass, with new `completed_by_me` assertions.
  - The deep-link rules were checked against 22 URL forms: custom scheme, App Links, dev-server `/--/`, warm and cold, encoded ids, and paths that are already pinned.
  - Their output was resolved with Expo Router's own `getStateFromPath` over the app's real route tree. That reproduced both bugs (a cold `/paper/abc` landed in `(explore)`, and `/papers/abc` landed on `+not-found`) and confirmed the fix: every rewritten path lands in its intended tab and screen.
  - Typecheck had been failing inside `phosphor-react-native` (its icon source passes `className` to `<Svg>`, which react-native-svg 15.16 doesn't declare). `src/types/react-native-svg.d.ts` declares the prop. Remove that file once either package fixes it.
  - Not yet seen on a device: a cold-start link opening on the tab's root with Back, and the offline strip in airplane mode. Both are added to the device checklist in §6.
- **Not yet verified on a phone.** Native-only behaviour still needs checking on the EAS development build: video playback, upload tasks, haptics, the keyboard over the comment composer, and predictive back on the create screens. See the checklist in §6.

## 6. Deferred and follow-up work

| Item | Why it waits | How to finish |
| --- | --- | --- |
| **One EAS development build** with the new native modules: expo-video, image-picker, image-manipulator, file-system, haptics, localization, web-browser, clipboard, secure-store, network, navigation-bar, keyboard-controller, svg, `@expo/ui`, `expo-dev-client` | Native modules need a rebuild; Expo Go for SDK 58 isn't in the stores | `npx eas-cli@latest build --platform android --profile development`. Every native dependency is already installed, so one build covers the plan |
| **Device checklist** | Can't be checked in the web build | Reels: swipe, autoplay of only one, pause on tab change, mute. Upload of an image and a reel, with the banner states. Comment composer with the keyboard. Discard prompt on create, with predictive back. Pinch-zoom on a figure. Bangla at 200% font size. Light and dark on a Samsung (OEM Bengali fonts). Deep links: with the app closed, `adb shell am start -a android.intent.action.VIEW -d "doshomikbytes://paper/<id>"` opens the paper in Home, and Back goes to the feed; the same with the app open stays in the current tab. Offline: airplane mode shows the ink strip after about 1.5 s, and turning it off shows "Back online", then nothing; a failed action's toast sits above the strip |
| **Android App Links for share URLs** | They need the production domain: the `intentFilters` and the server's `assetlinks.json` (already served by the API, from `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_FINGERPRINTS`) must name the same host | Add `android.intentFilters` (`autoVerify: true`, `https`, the host, path prefixes `/p/`, `/papers/` and `/courses/`) in `app.config.ts` from an env var. The app side already maps those paths (`shell/deep-links.ts`) |
| **The upload banner can cover a toast** | Pre-existing: toasts sit a fixed distance above the tab bar, and the upload banner (56 dp or more) sits inside it. The offline strip's offset is already handled | Put the upload banner's visibility in a store, as `lib/connection.ts` does, and add its height to the toast offset |
| **Auth phase** (sign-up, login, Google, 2FA prompt, logout, delete account, sessions list) | The owner's "auth last" rule | Store tokens in `expo-secure-store`. Add `Authorization` and refresh-once-on-401 in `api/client.ts`. Remove the dev "Act as" switch from release builds (it already shows only in `__DEV__`) |
| **Push notifications** | FCM isn't set up (backend §3.5) | Register the Expo push token with `PUT /sessions/current/push-token` after sign-in |
| **Maps and roadmaps from AI** (Group C) | Not built on the server | Library › Maps, as noted in §2 |
| **Trails: drag to reorder** | Up/down buttons are accessible and need no gesture dependency | Optional, later |
| **Explore and Reels ranking** | Waits for Redis and watch data (backend §3.1) | Swap the query on the server; the app doesn't change |

## 7. Known limitations

- **Bangla names for areas** are kept on the device for the five launch slugs; an area added later shows its English name until `fieldName` learns it, or until fields get a Bangla name column.
- **Signed media URLs** expire after about a day. Persisted feed pages are capped at 24 hours, and refetch on open replaces them.
- **Web is for QA only:** form sheets, haptics and native video caching differ there. The product is the Android app.
