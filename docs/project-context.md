# Doshomik Bytes — Project Context & UI/UX Specification

> Drop this file at the repo root (`PROJECT_CONTEXT.md`, or rename to `AGENTS.md` / `.cursorrules` / `CLAUDE.md` as your tool expects). It describes *what we are building* and *how it must look and feel*.
>
> **Source of truth:** `docs/Prototype v1 — Features, User Flows & Database Schema.md` is the absolute truth for scope, features, user flows and the database. This file has been aligned to it. If anything here ever disagrees with that document, that document wins. When an instruction in a task conflicts with either file, follow the files unless the task explicitly overrides them.

---

## 0. Condensed context (paste this when you only have room for one paragraph)

Doshomik Bytes (দশমিক বাইটস) is a bilingual Bangla/English mobile social-learning app for machine learning, AI and research: a short-form social feed whose content is educational rather than entertainment. Prototype v1 is Android-first, built with React Native + Expo + TypeScript, a Node.js API and one PostgreSQL database with 16 tables across four areas: Social, Learn, Practice and Research. Users post text, one image, or one reel (up to 90 seconds), follow people, like, comment and reply. They learn from short learn items and team-made courses, practise MCQ and short-answer questions by topic, and read structured summaries of research papers with a "Learn first" list, a saved/reading/completed tracker, a starting roadmap per field and a discussion thread. The app has five tabs (Home with Feed and Research sub-tabs, Learn with Practice inside, Explore, Reels, Profile); Create, the language switch and Notifications sit in Home's header. The UI follows mainstream social-app conventions users already know from Instagram-class apps: a fixed bottom tab bar, a full-screen vertical swipe reel viewer, bottom sheets for secondary actions, double-tap to like and pull-to-refresh, so navigation needs no learning. The visual identity is our own (our palette, our wordmark, our icon set): we borrow the *interaction patterns*, never the *branding*. Light-first in the owner's colour theme (dark available), Bangla-first typography, fast on cheap Android phones and slow networks.

---

## 1. Product overview

### 1.1 What it is

Doshomik Bytes is a **social learning platform for ML, AI and research**, in Bangla and English. Its purpose is to turn the short-form scrolling habit into actual learning. A user opens the app expecting the familiar loop of a social feed and gets educational content: a 45-second reel on attention, an image post on gradient descent, a short learn item explaining batch normalisation, a structured summary of a paper they had been too intimidated to open.

Content covers ML fundamentals, deep learning, neural networks, transformers, generative AI, LLMs, AI agents and current research.

### 1.2 Who it is for

Mainly Bangladeshi and West Bengali students and early-career engineers who want to get into ML/AI, and for whom English technical prose is a second barrier on top of a hard subject. Assume a mid-range Android phone, intermittent 3G/4G, a limited data budget, Bangla as first language and English as a working second language. The team (admins) creates the courses, learn items, questions, papers and roadmaps; users create posts.

This audience shapes every technical decision. Low-end Android performance, a small bundle, aggressive media optimisation, graceful offline states and Bangla text rendering are **product requirements, not polish.**

### 1.3 Platform and stack

The production stack is in `docs/stack-v1.txt`. Prototype v1 is built and tested **locally** first, using only what that needs (no Docker for now).

- **Mobile:** React Native + Expo + TypeScript. Android-first; the codebase stays cross-platform-clean so iOS is a scheduling decision, not a rewrite. Never add an Android-only native dependency without noting the iOS consequence.
- **API:** Node.js over HTTPS. It handles authentication, content, search and permissions.
- **Database:** one PostgreSQL database, 16 tables, exactly as defined in the Prototype v1 schema: real constraints, indexes and versioned migrations. Search uses Postgres itself (full-text indexes plus `pg_trgm`), not a separate search engine.
- **Media:** files live in object storage (S3, Cloudflare R2, the VPS disk or similar); the database stores only the URL. During local development, media is stored on disk and served by the API behind a storage interface.
- **Jobs:** Redis + a queue worker with FFmpeg for video processing (validation, transcoding, thumbnails), never in the request path.
- **Admin:** admins are ordinary users with `role = 'admin'`. A React admin dashboard is where they create courses, learn items, questions, papers and roadmaps.
- **Later (deployment):** Hostinger VPS, Caddy, Docker Compose, as described in `stack-v1.txt`.

### 1.4 Core feature set (Prototype v1)

| Area | What ships |
| --- | --- |
| **Account and profile** | Sign up and log in with email, username and password. Edit profile: display name, bio, avatar. Profile page shows posts and follower/following counts, plus the paper reading tracker. |
| **Social** | Create a post: text only, one image, or one reel (up to 90 seconds). Home feed: posts from people you follow, newest first. Reels page: reels only, in a scrolling viewer. Like and comment on posts, reply to comments. Follow and unfollow users. |
| **Learn** | Learn items: a single short video, figure/diagram, or text explanation, each tagged with one topic. Courses: an ordered set of learn items made by the team. External courses: a card linking to a free outside course (Udemy and similar). One learn item can stand alone and also sit inside one or more courses. |
| **Practice** | MCQ and short-answer questions, each tagged with a topic. Pick a topic or get random questions. Answer, then see the correct answer and the explanation. |
| **Research** | Paper list (about 50 at launch), filter by field, search. Paper page: original link, research questions, main idea, data source, step-by-step method, results, figures, limitations, evaluation. Learn first: the topics to know before reading, with our videos where we have them. Save a paper and track it as saved, reading or completed. Starting roadmap: pick a field and get papers in reading order. Discussion under each paper, with replies. |
| **Across the app** | Notifications for follows, likes, comments and replies. One search box covering users, posts, topics, learn items, courses and papers. |

Everything is free.

Rules that keep v1 small (from the Prototype v1 doc):

- One media file per post, no carousels. Reels are capped at 90 seconds.
- One `comments` table serves both post comments and paper discussions.
- One starting roadmap per research field.
- Paper list sections (research questions, method steps, figures) live inside the `papers` row.

### 1.5 Hard product constraints — do not violate these

1. **The Prototype v1 doc is the scope.** Build its features, flows and 16 tables, and nothing it lists under "Left out of v1". New capabilities arrive later as new tables or columns, without changing what v1 already has.
2. **Bilingual is structural, not an afterthought.** Every user-facing string goes through i18n from the first commit. No hardcoded English in JSX, ever. Bangla and English content coexist in the same feed, in the same list, sometimes in the same post.
3. **`papers` is a first-class database entity**, not a kind of post. Papers are tied to Learn and Practice through `topics` (`paper_prerequisites` → `topics` ← `learn_items`), so adding a video for a topic makes it appear in every paper that lists that topic.
4. **We never host research PDFs.** The paper page links out to the original (`paper_url`). Admins add figures only when the paper's licence allows reuse.
5. **Paper pages are structured summaries, not narrative ones.** They show the labelled sections (research questions, main idea, data source, method steps, results, figures, limitations, evaluation) written by the team, plus Learn first. The point is to get the user ready to read the paper, not to replace reading it.
6. **Server-side rules match the database.** Reels over 90 seconds, self-follows, comments attached to nothing and other invalid rows are rejected by the API and by the schema's `CHECK`s.

### 1.6 Explicitly out of scope for v1

From the Prototype v1 doc's "Left out of v1": course progress; practice history and scores; named quizzes; several images per post (carousels); several roadmaps per field; a paper in several fields; a learn item covering several topics; saved posts (bookmarks), blocking, reporting, hashtags, messages and view counts; email verification, password reset and sessions.

Also not in v1: AI-generated content of any kind (summaries, chat with a paper, recommendations); a For You feed (Home is the following feed only); shares; video captions/subtitle tracks; links from posts to papers or lessons; paper difficulty, licence badges, lineage or peer reviews; livestreaming; creator monetisation; gamification; code execution sandboxes; moderation tools.

Do not build these, and do not leave half-built scaffolding for them. When v1 expands, course progress and practice history are the most likely first additions.

---

## 2. UI/UX design direction

### 2.1 The governing principle

**Borrow the interaction grammar of mainstream social apps; never borrow their brand.**

Our users already know how an Instagram-class app works. They know the bottom tab bar is navigation, the heart is a like, a card with an avatar at the top-left is a post, a full-screen video that swipes vertically is a reel, three dots open options, and a swipe down dismisses a sheet. We adopt every one of those conventions as-is, because every convention we invent instead is a tax on a user who came here to learn ML, not to learn our app.

So layout, navigation, gestures, affordance placement and information density should feel immediately familiar to anyone who uses Instagram, TikTok or YouTube Shorts.

**What we never copy:** Instagram's wordmark, logo or camera glyph, their icon set, their magenta-orange-purple gradient, their exact colour values, their illustrations, or any of their proprietary assets. Our visual identity (palette, wordmark, iconography, illustration style) is our own and is defined below. If you find yourself reproducing a recognisable piece of someone else's branding, stop and use our tokens instead.

### 2.2 Information architecture

> Updated 26 Nov 2026 to the owner's frontend brief (it replaces the earlier five-tab layout). Decisions and the full Research design: [`frontend-implementation-notes.md`](frontend-implementation-notes.md).

**Five fixed bottom tabs. Home has its own header and two sub-tabs:**

```
┌────────────────────────────────────────────────────────────┐
│  (+)            Doshomik. (wordmark)       [বাং|EN]  Bell  │  ← Home header
│               Feed               Research                  │  ← Home sub-tabs
├────────────────────────────────────────────────────────────┤
│                         CONTENT                            │
├────────────────────────────────────────────────────────────┤
│   Home      Learn      Explore      Reels      Profile     │  ← tab bar
└────────────────────────────────────────────────────────────┘
```

- **Home › Feed** — posts (text, image, reel) from people you follow, newest first. Reels show a poster that opens the full-screen viewer. With few follows, "Suggested for you" and a way into Research.
- **Home › Research** — the main attraction: your desk (one contextual row: Up next, this month, pick your fields, or start a roadmap), reading paths (Roadmaps, Trails), then papers by area with search. Pushes Paper, Learn first, Roadmaps, Trails, Trail, Library.
- **Learn** — area chips (ML fundamentals, Deep learning, Computer vision, Transformers, LLMs), Continue, courses (ours and free outside ones), lessons by concept. A **Practice** button in the header opens practice (by area or Random, named quizzes, history).
- **Explore** — one search box for people, papers, lessons, courses, topics and posts (results in Top · Papers · Learn · People · Posts); while not searching, a grid of posts filtered by area.
- **Reels** — reel posts only, full-height vertical paging; the tab bar stays.
- **Profile** — avatar, name, bio, counts, Edit profile or Follow, then `Posts · Research` (reading counts and published trails). Settings from the gear.
- **Header: Create (+)** — a sheet: `Text · Image · Reel`, each a full-screen flow. **Language switch** — EN/বাং for the whole app. **Bell** — notifications with an unread dot.

The tab bar has labels; the active tab gets a filled icon, full-strength label and a small amber dot. Tapping the active tab returns its stack to the top. It is hidden only under full-screen screens (create flows, trail editor, edit profile, the single-reel viewer, the image viewer).

**Pushed screens**, shared by every tab's stack: Paper, Learn first, Roadmaps, Trails, Trail, Library, Paper search, Course, Lesson, Topic, Practice, Practice session, Practice history, Post, Comments, Profile, Notifications, Settings.

### 2.3 Visual language

**Light-first**, in the owner's colour theme (mockups of 26 Nov 2026): a warm light-grey page, white surfaces, ink text, a deep teal primary, mint washes and amber as the second accent. Dark is a full first-class theme on the logo's ink. Every colour is a semantic token in `apps/mobile/src/theme/tokens.ts`, never a literal.

#### Colour tokens

```ts
// Light theme (default)
bg            #F3F4F1   // page
surface       #FFFFFF   // rows, sheets, inputs
elevated      #ECEEEA   // pressed, skeletons, switch track
border        #E2E4DF
text          #15181E
textSecondary #50555C
textTertiary  #7B8086
accent        #12755E   // deep teal: primary actions, links, bookmarks, progress, reading dots
accentWash    #DDF1E9   // mint wash behind accent badges
highlight     #F2A20C   // amber: active-tab dot, New/Trending badges
inverse       #16191F   // ink: selected chip, "Up next" banner

// Dark theme
bg #16191F · surface #1E2128 · elevated #282C34 · border #30343D
text #F4F1E8 · accent #5BC9A1 (the logo's mint) · highlight #F5A524

// Semantic
like #E5484D · danger #D33A40 · alert (unread dot) #EF5350
```

Shapes: blocks 12, buttons and chips 8, badges 4; no pills. Lists are rows on one white surface with hairline dividers, not stacks of floating cards.

#### Typography

Two families, loaded together, selected per script:

- **Latin:** Inter (or the system `-apple-system` / Roboto fallback).
- **Paper titles and reading surfaces:** Source Serif 4 (Bengali runs inside it use Noto Sans Bengali).
- **Labels and step numbers:** JetBrains Mono, upper-case for Latin only.
- **Bangla:** Noto Sans Bengali (fallback: Hind Siliguri). Bangla conjuncts and matras need vertical room, so Bangla text gets **line-height 1.6–1.7**, compared with 1.4–1.5 for Latin. Never apply negative letter-spacing to Bangla. Never force uppercase on Bangla (it has no case). Pick Western Arabic numerals app-wide unless a string is explicitly localised otherwise, and be consistent.

```
display   28/34  bold      screen titles
title     20/26  semibold  section heads, sheet titles
body      15/22  regular   post text, captions, learn item text, paper sections
bodyBold  15/22  semibold  usernames, labels
caption   13/18  regular   timestamps, counts, metadata
micro     11/14  medium    badges, chips, tab labels
mono      14/20  regular   code (JetBrains Mono / Fira Code)
```

Mixed-script lines are common (`Transformer-এর attention mechanism`). Test every text component with a Bangla + English + code-span string: nothing may clip, and nothing may reflow jarringly between languages.

#### Shape, spacing, elevation

- **Spacing scale:** 4dp base: `4, 8, 12, 16, 20, 24, 32, 40, 48`. Screen horizontal padding is 16dp. Nothing uses an off-scale value.
- **Radii:** `sm 8` inputs and chips · `md 12` cards, thumbnails, images · `lg 20` bottom sheets (top corners only) · `full` pills, avatars, Follow buttons.
- **Elevation:** show depth with surface colour and a 1dp subtle border, not drop shadows (dark-mode shadows are invisible anyway). Bottom sheets get a 60% black scrim.
- **Icons:** one outline/filled set at 24dp (tab bar 26dp, inline actions 20dp), stroke 1.75–2dp. Pick one library and never mix: outline for inactive, filled for active or engaged states.
- **Avatars:** 32 (comment) · 40 (feed header, list rows) · 48 (notification) · 88 (profile header). Always circular, always with an initials fallback on a brand-tinted background.
- **Touch targets:** at least 44×44dp, even when the visible glyph is 20dp.

### 2.4 Screen patterns

**Feed post card**
One row with avatar 40, username (bodyBold) and timestamp (caption), and a three-dot menu right-aligned (Delete for your own post). Image or reel media runs full-bleed to the card edges at 12dp radius, in aspect ratio 1:1, 4:5 or 9:16. Text posts show the caption as the body. The action row below has heart and comment. Then come the like count, the caption with 2-line truncation and a `more` affordance, and `View all 24 comments`. Double-tap the media to like, with a brief heart-scale animation and a light haptic.

**Comments (post comments and paper discussion)**
The same component serves both. Each comment shows avatar 32, username, body and timestamp, with a `Reply` action. Replies sit indented under their parent. The input is pinned to the bottom with the keyboard.

**Reel viewer**
Full-screen vertical paging, snap-to-item, one item per viewport. A right-edge vertical action rail holds the creator avatar (with a + follow affordance), heart + count, comment + count (opens the comments sheet) and three-dot. Bottom-left shows the username and the caption (2 lines, expandable). Tapping toggles play/pause, with no visible chrome change beyond a brief icon. Progress is a 2dp hairline at the very bottom, scrubbable on drag. Pre-buffer the next two items, and never autoplay more than one video's audio.

**Create flow**
A bottom sheet with three rows (Text, Image, Reel), each with a leading icon and a one-line description. Each row opens a full-screen flow with an explicit `Cancel` / `Post` header, never a back-swipe that silently discards work, and always a confirmation before discarding a draft. A text post needs a caption; an image or reel post needs its one file plus an optional caption. A reel longer than 90 seconds is rejected at pick time with a clear message, and the server checks again. Upload progress shows in a persistent, dismissible banner so the user can keep browsing while a video processes. Once posted, it appears on your profile and in your followers' Home feeds; reels also appear on the Reels page.

**Search**
A pill search field (`bg.surface`, 40dp) and results grouped into sections by type: Users, Posts, Topics, Learn items, Courses, Papers. Each section shows its top matches with a `See all`. Typos in usernames and topic names still match. Paper results render as a distinct card with the `brand.research` accent, so they read as a different *kind* of thing, not just another post.

**Learn**
Course cards show thumbnail, title, description and the number of items. External course cards carry an "external" marker and open the outside link in the browser. Learn items are listed and searchable on their own: a video item plays inline, an image item (figure, diagram, flowchart) is pinch-zoomable, and a text item reads as a short article. The course screen lists its items in order and steps through them with a sticky bottom bar: `Previous · step 3 of 8 · Next`. Course progress is not stored in v1.

**Practice**
A topic picker (chips or a list) plus a `Random` option. One question per screen. MCQ shows its options as large tappable rows; a short question shows a text input. After `Submit`, show right or wrong with an icon *and* a colour, the correct answer and the explanation, then `Next question`. Nothing is scored or saved in v1.

**Research list**
Field filter chips across the top (ML, DL, CV, LLM…), a search field, and a `Starting roadmap` entry card. Paper cards show title, authors, year, field and the user's tracker status if saved.

**Paper screen**
A single scrolling page. The header has the title, authors, year and field, an `Open original` link-out (`paper_url`), and a Save control that moves Saved → Reading → Completed. Below it, a prominent `Learn first` button. Then the summary sections, as labelled blocks in this order: Research questions (a list) · Main idea · Data source · Method (numbered steps) · Results · Figures (image + caption, pinch-zoomable) · Limitations · Evaluation. Discussion comes last, with replies.

**Learn first**
The paper's prerequisite topics in order. A topic with learn items shows those items (video, figure or text) so the user can open them. A topic without any shows the topic name and its short summary. A line at the top such as "We have videos for 3 of 5 topics" sets expectations.

**Starting roadmap**
Pick a field, then see that field's papers in reading order: a step number, the paper card, and a one-line note on why it comes at that point. A roadmap may include papers from other fields. Tapping a paper opens the Paper screen.

**Notifications**
A list of follow, like, comment and reply notifications: actor avatar 48, a one-line description and a timestamp, with unread rows visibly marked (a dot *and* a background tint). Tapping goes to the post, comment or profile and marks the notification read.

**Profile**
Avatar 88, display name, username and bio, then counts (posts / followers / following), then `Follow`/`Unfollow` or `Edit profile`. Below that, the `Posts · Papers` tabs: Posts is a 3-column grid with 2dp gutters (reels marked with a small play glyph, text posts as text tiles), and Papers is the reading tracker grouped into Saved, Reading and Completed. Edit profile changes display name, bio and avatar.

**Sign up and log in**
Sign up asks for email, username and password, and nothing else. Errors are inline and specific (username taken, email already used, password too short). After sign-up the user lands on Home.

**Empty, loading, error, offline**
Every list has all four designed. Loading is a skeleton of the real layout (shimmering `bg.elevated` blocks), never a centred spinner on a blank screen. Empty states get an icon, one line of explanation and one action. Errors say what failed and offer `Retry`. Offline shows a persistent slim banner and serves cached content. Treat a slow, flaky connection as the normal case, not the edge case.

### 2.5 Motion and feedback

Fast and purposeful: 150–200ms for taps, state changes and sheet dismissals; 250–300ms for screen transitions and sheet presentation. Standard easing (`ease-out` entering, `ease-in` exiting); springs only for the like animation and sheet drag. Respect `prefers-reduced-motion` and fall back to crossfades.

Use a light haptic on like, follow, saving a paper, submitting a practice answer and triggering pull-to-refresh. Nothing else; haptics on every tap is noise.

Every interactive element has a visible pressed state (opacity 0.7 or a `bg.elevated` fill). No optimistic UI without a rollback path: likes, follows and paper saves/status changes apply instantly and revert visibly with a toast if the request fails.

### 2.6 Accessibility and inclusivity

- Text contrast of at least 4.5:1 for body text and 3:1 for large text, in both themes. Check the accents on both backgrounds.
- Respect the OS font-scale setting up to 200%. No fixed-height text containers. Test the feed card, reel caption and paper sections at maximum scale.
- `accessibilityLabel` on every icon-only control, in the active language.
- Never use colour alone to convey state; pair it with an icon or label (the like heart fills *and* changes colour; a correct answer shows a check *and* turns green).

### 2.7 Performance rules the UI must respect

The feed and the reel viewer are where this app lives or dies on a cheap Android phone.

- Virtualised lists everywhere (`FlashList`, or `FlatList` with a tuned `windowSize`); never map over an unbounded array.
- Memoise feed and reel items; a parent re-render must not re-render the list.
- Images: resized to the size actually displayed, blurhash or progressive placeholders, and explicit width and height to prevent layout shift.
- Video: at most one active decoder plus limited look-ahead buffering; release players as items leave the viewport. Target smooth 60fps scrolling on a 4GB mid-range device.
- Cursor pagination with prefetch at about 70% scroll depth; never offset pagination.
- Cache aggressively and revalidate in the background. The second open of the app should show content before the network answers.

### 2.8 Anti-patterns — do not do these

- Do not invent novel navigation. If a user would have to learn it, it is wrong.
- Do not build anything from the "Left out of v1" list, or scaffold for it.
- Do not add AI-generated content or a narrative AI summary of a paper anywhere in v1.
- Do not use skeuomorphism, heavy gradients, glassmorphism or decorative illustration. The content is the visual interest; the chrome is quiet.
- Do not add a modal, interstitial, upsell, rating prompt or onboarding carousel that is not explicitly specified.
- Do not hardcode colours, spacing, font sizes or English strings.
- Do not ship a screen without its loading, empty, error and offline states.
- Do not reproduce another product's logo, wordmark, icon set, gradient or proprietary assets.

---

## 3. How to work in this repo

- Treat `docs/Prototype v1 — Features, User Flows & Database Schema.md` as the source of truth, and do not edit it. Its appendix SQL is the first migration.
- **Never run `git commit` or `git push`.** The project owner does all git committing. Do not stage files, create or switch branches, stash, reset, rebase, merge or tag either, unless the owner explicitly asks in that message. Reading git state (`status`, `diff`, `log`) is fine. Leave finished work uncommitted and list the changed files in your summary.
- Build **feature by feature**, and test each feature before integrating the next.
- Shared UI primitives live in a single `components/ui` layer with themed tokens; feature screens compose them and never restyle from scratch.
- Enforce authorisation on the server for every endpoint; the client is never the permission boundary. Admin-only actions check `users.role = 'admin'`. Validate and bound every input and every upload.
- Write the migration with the feature, not after it. Later additions are new tables or columns that leave v1's tables intact.
- When something in these files is ambiguous for the task at hand, state the assumption you made in your summary rather than silently choosing.
