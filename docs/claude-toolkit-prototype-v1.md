# Claude Toolkit for Prototype v1

Nov 22, 2026 · Doshomik Bytes

Everything Claude Code needs to build Prototype v1: skills, plugins, MCP servers, subagents, hooks, and the open-source libraries for the mobile app, backend, admin dashboard and database. Every item is free. Where a tool has a paid tier, only the free tier is needed.

**Sources**

- `docs/Prototype v1 — Features, User Flows & Database Schema.md` is the **scope** for v1. It sets the features, flows and the 16-table schema.
- `docs/stack-v1.txt` is the **final production stack**. Its own note says v1 builds only what local testing needs and **avoids Docker entirely for now**.
- `docs/project-context.md` is the **product and UI/UX spec**: design tokens, typography, Bangla rules, screen patterns, performance rules and anti-patterns. It has been aligned to the Prototype v1 doc.

The Prototype v1 doc is the absolute truth and is never edited. If any other doc disagrees with it, the Prototype v1 doc wins.

---

## 0. Decisions applied for v1

| Topic | Decision | Notes |
| --- | --- | --- |
| Reel length | **90 s**, enforced on the client, by the API (ffprobe) and by the DB `CHECK` | `stack-v1.txt` still says 60 s for the final product. Keep the limit as one constant in `packages/shared`. |
| Navigation | Tabs: Home, Reels, Learn, Practice, Research. Header: Create (+), Search, Notifications, Profile | As in project-context §2.2. |
| Media storage | **Local disk** (`apps/api/media/`) served by the API, behind a `StorageAdapter` interface | The VPS disk or S3/R2 can be plugged in later; the DB only stores the URL. |
| Docker, Caddy, Compose | **Not used in v1.** Run everything natively on Windows | Per the note in `stack-v1.txt`. |
| Left-out features | Not built and not scaffolded | The full list is in project-context §1.6. |
| Admin dashboard | A **content CMS** (topics, fields, learn items, courses, questions, papers, roadmaps) | There is no moderation in v1. |
| Auth | **Self-managed** email + username + password with argon2 and a JWT | No paid auth service. |
| Bilingual | **i18n from the first commit** (bn + en), with Bangla fonts and line-heights | Known gap: the schema's `to_tsvector('english', …)` indexes won't stem Bangla. Trigram search still matches Bangla usernames and topic names. |
| Git commits | **Claude never runs `git commit` or `git push`.** The project owner does all committing and pushing. | Claude may read git state (`git status`, `git diff`, `git log`). It leaves changes uncommitted in the working tree for the owner to review. Enforced by a hook (§5). |
| Git history changes | **Claude never runs `git add`, `git reset`, `git rebase`, `git merge`, `git tag`, `git stash`, or creates or switches branches**, unless the owner asks in that message | This also applies to slash commands and plugins that commit for you (`/commit`, commit-push-PR flows). |

---

## 1. Quick-start checklist (in order)

1. The owner runs `git init` in the repo root, since the GitHub MCP and code review assume git. Claude doesn't commit; see §0.
2. Install the system tools: Node.js LTS (24.x or newer), pnpm, PostgreSQL 16+, FFmpeg, Android Studio (emulator), and Redis through WSL2 or Memurai Developer. See [§9](#9-windows-setup-notes).
3. Run `/init` to create `CLAUDE.md`. Point it at `docs/project-context.md` and this file, and add the §0 decisions.
4. Install the plugins in [§3](#3-plugins-official-claude-code-marketplace).
5. Add the MCP servers in [§4](#4-mcp-servers) (priority **Core** first).
6. Use `skill-creator` to create the project skills in [§2.2](#22-project-skills-to-create-with-skill-creator).
7. Use the `update-config` skill to add the hooks in [§5](#5-subagents-and-hooks).
8. Scaffold the monorepo in [§6](#6-open-source-stack-all-free).

---

## 2. Claude skills

### 2.1 Skills already available in Claude Code

| Skill | What it does for v1 | When |
| --- | --- | --- |
| `init` | Generates `CLAUDE.md` from the repo. Merge the key rules from `project-context.md` (tokens, i18n, performance, anti-patterns) and the §0 decisions. | Day 1 |
| `frontend-design` | Visual direction for screens and the admin dashboard, kept inside the token system in project-context §2.3: no hardcoded hex values, a quiet interface, no glassmorphism. | Every UI feature |
| `run` | Launches and drives the app (API, Expo, admin) so Claude can check a change in the running app, not only in tests. | After each feature |
| `code-review` | Correctness review of the current diff (`low`/`medium` for normal work, `high` before merging a feature). | End of each feature |
| `security-review` | Reviews auth (hashing, JWT, rate limits), upload handling (size, MIME, duration, path traversal), authorisation on every endpoint, and admin-only routes. | After auth, after uploads, before any VPS deploy |
| `simplify` | Cleanup pass for reuse and simplification on changed code. | After a feature works |
| `update-config` | Sets up hooks, permissions and env vars in `.claude/settings.json`. | Day 1 and as needed |
| `fewer-permission-prompts` | Allow-lists the read-only commands you run often (pnpm, psql, tsc, git status). | After the first week |
| `skill-creator` | Builds the project skills in §2.2. | Day 1 |
| `anthropic-skills:built-in-browser` / `anthropic-skills:chrome-browser` | Lets Claude click through the React admin dashboard and Expo web in a browser. | Admin dashboard work |
| `dataviz` | Optional: simple counts on the admin dashboard home (users, posts, papers saved). | Optional |
| `onboarding`, `signup` | Optional UX input for the sign-up flow and the empty Home state ("suggest people to follow, point to Learn and Research"). | Sign-up feature |

**Not needed for v1:** `claude-api` (v1 has no LLM features), `pdf`/`docx`/`pptx`, and the marketing skills other than the two above.

### 2.2 Project skills to create (with `skill-creator`)

These carry the repo's rules so Claude applies them every time without being re-told. Store them in `.claude/skills/`.

| Skill | Contents | Used by |
| --- | --- | --- |
| `doshomik-ui` | Theme tokens (dark and light), the type scale, the Bangla rules (line-height 1.6–1.7, no negative letter-spacing, no uppercase), the spacing and radius scale, avatar sizes, 44 dp touch targets, motion timings, haptics rules, and the rule that every screen ships loading, empty, error and offline states. Includes a template for a themed primitive in `components/ui`. | Every mobile screen |
| `doshomik-api-endpoint` | The endpoint recipe: a zod schema for params, body and query; an auth guard plus an admin guard; an ownership check; cursor pagination (`created_at`, `id`), never offset; error shape; where to insert a notification row; and a test with `fastify.inject`. | Every backend feature |
| `doshomik-migration` | Writing one migration per feature with `node-pg-migrate`: naming, keeping the `CHECK`s from the appendix, indexes whose expressions match the queries, regenerating Kysely types afterwards, and the rule against editing an applied migration. | Schema changes |
| `doshomik-i18n` | Adding strings to `bn.json` and `en.json` together, key naming, plurals, `accessibilityLabel` in the active language, and a mixed-script test string (`Transformer-এর attention mechanism`). | Every UI string |
| `doshomik-media-upload` | The reel and image pipeline: picker limits, multipart upload, ffprobe duration and codec check, rejecting anything over 90 s, the BullMQ transcode job (H.264 720p MP4, `+faststart`, poster frame), and writing the URL into `media_url`. | Create post, admin uploads |
| `doshomik-feature-check` | The "done" checklist for a feature: migration, API, shared zod types, screen with all four states, i18n strings, tests passing, run in the emulator, `code-review`. | End of each feature |

---

## 3. Plugins (official Claude Code marketplace)

Install with `/plugin install <name>@claude-plugins-official`, or browse with `/plugin` → Discover. Names below are as listed in the official marketplace; confirm them in the Discover list, since the catalogue changes. All are free.

| Plugin | Why | Priority |
| --- | --- | --- |
| `typescript-lsp` | Gives Claude TypeScript diagnostics and go-to-definition across `apps/*` and `packages/shared`. Catches type errors right after an edit. | Core |
| `feature-dev` | A guided explore → plan → build → review workflow, which matches project-context §3 ("feature by feature, test each before the next"). | Core |
| `frontend-design` | Plugin form of the skill in §2.1. Install it if the skill isn't already in your session. | Core |
| `security-guidance` | Warns while editing when code introduces risky patterns (injection, unsafe file paths, secrets). | Core |
| `code-review` / `pr-review-toolkit` | Deeper multi-angle reviews once you open PRs on GitHub. | Recommended |
| `commit-commands` | **Do not install.** It makes Claude commit and push, and the project owner does all git committing. | Not used |
| `hookify` | Turns "don't do X again" into hooks, for example blocking hex colours in `apps/mobile/src/**`. | Optional |
| `context7` | Plugin form of the Context7 MCP in §4. Use one or the other. | Core |
| `playwright` | Plugin form of the Playwright MCP in §4. Use one or the other. | Recommended |

---

## 4. MCP servers

All are open source or have a free tier that covers v1. On **native Windows**, wrap `npx` commands in `cmd /c`, for example `claude mcp add playwright -- cmd /c npx @playwright/mcp@latest`.

| Server | Why for v1 | Add command | Cost | Priority |
| --- | --- | --- | --- | --- |
| **Context7** (`upstash/context7`) | Current docs for Expo SDK, expo-video, Expo Router, Reanimated, FlashList, Fastify, Kysely, BullMQ and TanStack Query. These APIs change between versions. | `claude mcp add --transport http context7 https://mcp.context7.com/mcp` | Free tier, optional free API key | Core |
| **Postgres MCP Pro** (`crystaldba/postgres-mcp`) | Lets Claude inspect the 16 tables, run `EXPLAIN` on the feed, search and Learn-first queries, check index usage (trigram and GIN), and run health checks. | `claude mcp add postgres -e DATABASE_URI=postgresql://dev:dev@localhost:5432/doshomik -- uvx postgres-mcp --access-mode=restricted` | Open source (MIT), needs `uv` | Core |
| **Mobile MCP** (`mobile-next/mobile-mcp`) | Lets Claude drive the Android emulator: tap through flows, take screenshots, check layouts at large font scales. | `claude mcp add mobile -- npx -y @mobilenext/mobile-mcp@latest` | Open source | Core |
| **Playwright MCP** (`microsoft/playwright-mcp`) | Drives the React admin dashboard: create a course, reorder items, add a paper with figures. | `claude mcp add playwright -- npx @playwright/mcp@latest` | Open source | Recommended |
| **Expo MCP** (official, `mcp.expo.dev`) | Expo-aware docs, SDK guidance and dev-tools hooks for the app. | `claude mcp add --transport http expo-mcp https://mcp.expo.dev/mcp` | Needs an Expo account. Check that your plan covers it; if not, skip it, because Context7 and Mobile MCP cover the same needs. | Optional |
| **GitHub MCP** (`github/github-mcp-server`) | Issues, PRs and CI once the repo is on GitHub. | `claude mcp add --transport http github https://api.githubcopilot.com/mcp/ -H "Authorization: Bearer <PAT>"` | Free with a personal access token | Optional |
| **Chrome DevTools MCP** (`ChromeDevTools/chrome-devtools-mcp`) | Network and performance traces for the admin dashboard and Expo web. | `claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest` | Open source | Optional |
| **Redis MCP** (`redis/mcp-redis`) | Inspect BullMQ queues and stuck transcode jobs. | `claude mcp add redis -- uvx --from redis-mcp-server@latest redis-mcp-server --url redis://localhost:6379` | Open source | Optional |

Use a **dev-only database user** for Postgres MCP, and keep it in `restricted` (read-only) mode unless you're deliberately letting Claude change data.

---

## 5. Subagents and hooks

**Built-in subagents** (no setup): `Explore` for searching the codebase as it grows, `Plan` for designing a feature before building it, and `general-purpose` for parallel side tasks such as writing seed data while the main session builds an endpoint.

**Custom subagents** (`.claude/agents/*.md`):

| Agent | Job |
| --- | --- |
| `schema-guardian` | Reviews each migration and query against the v1 schema: `CHECK`s kept, `ON DELETE CASCADE` on user-owned rows, search query expressions identical to the index expressions, no offset pagination. |
| `rn-performance-reviewer` | Reviews mobile diffs against project-context §2.7: FlashList, memoised items, one active video decoder, players released off-screen, explicit image sizes. |
| `i18n-auditor` | Flags hardcoded strings in JSX, missing `bn` or `en` keys, missing `accessibilityLabel`, and hardcoded colours or spacing. |

**Hooks** (set up with the `update-config` skill):

- **After an edit or write:** run Prettier (or Biome) on the changed file, plus `tsc --noEmit` for the touched workspace.
- **After an edit in `apps/mobile/src`:** run a grep check that fails on `#[0-9a-fA-F]{3,8}` literals and on raw string literals inside JSX text.
- **Before a shell command:** block `DROP DATABASE` and `rm -rf media`.
- **Before a shell command (git):** block `git commit`, `git push`, `git add`, `git reset`, `git rebase`, `git merge`, `git tag`, `git stash`, and `git checkout -b` / `git switch -c`. Read-only git (`status`, `diff`, `log`, `show`) stays allowed. Add the same commands to the `deny` list in `.claude/settings.json` permissions as a second guard.

---

## 6. Open-source stack (all free)

### 6.1 Repo layout

```
doshomik-bytes/
  apps/mobile      React Native + Expo (Android first)
  apps/api         Node.js API + BullMQ worker
  apps/admin       React admin dashboard (Vite)
  packages/shared  zod schemas, TS types, constants (REEL_MAX_SECONDS = 90)
  docs/
```

Workspaces use **pnpm**. Turborepo is optional; plain `pnpm -r` scripts are enough for v1.

### 6.2 Mobile app: `apps/mobile`

| Need (from the v1 features) | Library |
| --- | --- |
| App, routing, five tabs plus a header | Expo SDK (latest stable), **Expo Router**, TypeScript strict |
| Feeds, comments, paper list (virtualised) | **@shopify/flash-list** |
| Reels viewer (vertical paging, one decoder) | **expo-video**, with FlashList paging (or `react-native-pager-view`) |
| Images with blurhash placeholders | **expo-image** |
| Picking image or reel, 90 s limit on the client | **expo-image-picker** (`videoMaxDuration: 90`; it returns `duration`) |
| Gestures, double-tap like, sheet drag | **react-native-gesture-handler**, **react-native-reanimated** |
| Create sheet, options sheets | **@gorhom/bottom-sheet** |
| Server state, caching, optimistic like/follow with rollback | **@tanstack/react-query** (+ `@tanstack/query-async-storage-persister` so cached content shows on the next app open) |
| Small client state (auth, theme) | **zustand** |
| Forms (sign-up, edit profile, create post) | **react-hook-form** + **zod** (schemas shared with the API) |
| JWT storage | **expo-secure-store** |
| Bilingual UI | **i18next**, **react-i18next**, **expo-localization** |
| Fonts: Inter and Noto Sans Bengali | **@expo-google-fonts/inter**, **@expo-google-fonts/noto-sans-bengali**, **expo-font** |
| One icon set (outline and filled) | **phosphor-react-native** (it has both weights; don't mix sets) |
| Haptics: like, follow, quiz submit, refresh | **expo-haptics** |
| Offline banner | **@react-native-community/netinfo** |
| Safe areas, status bar | **react-native-safe-area-context**, **expo-status-bar** |
| Upload progress banner | `expo-file-system` upload task, or `XMLHttpRequest` progress events |
| Opening external course and paper links | **expo-web-browser** |

### 6.3 Backend: `apps/api`

| Need | Library or tool |
| --- | --- |
| HTTP server | **Fastify** (built-in pino logging, `inject` for tests) |
| Validation (shared with mobile) | **zod** + **fastify-type-provider-zod** |
| Auth | **argon2** (password hash) + **@fastify/jwt**; **@fastify/rate-limit** on login and sign-up |
| CORS, uploads, static media | **@fastify/cors**, **@fastify/multipart** (size limits), **@fastify/static** (serves `media/`) |
| Database driver and query builder | **pg** + **Kysely** (typed SQL that stays close to the doc's queries) + **kysely-codegen** (types from the live DB) |
| Migrations | **node-pg-migrate**. Migration `001` is the appendix SQL script, unchanged. |
| Search (users, posts, topics, learn items, courses, papers) | Postgres only: `pg_trgm` (`%`, `similarity()`) and `websearch_to_tsquery` against the exact index expressions. No separate search engine. |
| Background jobs | **BullMQ** + **Redis** (WSL2 or Memurai on Windows) |
| Video and image processing | **FFmpeg / ffprobe** called through **execa** or `child_process.spawn`. Don't use `fluent-ffmpeg`; it is archived. Use **sharp** to resize avatars and images. |
| Config | **dotenv** + a zod-validated `env.ts` |
| Seed data (~50 papers, topics, fields, roadmaps, users) | **@faker-js/faker** + hand-written JSON for the real papers |

**How reels flow through the API:** multipart upload → save to `media/tmp` → ffprobe (rejects missing video, over 90 s, wrong type) → enqueue a BullMQ `transcode` job → the worker writes `media/reels/<id>.mp4` and a poster image → insert the `posts` row with `media_url` and `duration_seconds`. Because the DB `CHECK` requires `media_url` on reels, the row is created only once the file exists, or with the original file's URL while transcoding runs.

### 6.4 Admin dashboard: `apps/admin`

| Need | Library |
| --- | --- |
| App | **React** + **Vite** + TypeScript |
| UI kit | **Tailwind CSS** + **shadcn/ui** (copy-in components, MIT) |
| Routing and data | **React Router**, **@tanstack/react-query** |
| Tables (papers, questions, learn items) | **@tanstack/react-table** |
| Forms (paper editor with `research_questions[]`, `method_steps[]`, `figures` JSON) | **react-hook-form** (`useFieldArray`) + **zod** |
| Reordering course items and roadmap steps (`position`) | **@dnd-kit/core** + **@dnd-kit/sortable** |

Admin screens for v1: topics, fields, learn items (upload video or image, or write text), courses and course items, external courses, questions (MCQ or short), papers (all summary fields, figures, prerequisites), and starting roadmaps. Admin routes require `users.role = 'admin'` on the server.

### 6.5 Database and dev tools

| Tool | Use |
| --- | --- |
| **PostgreSQL 16+** (Windows installer) | The 16-table schema with `pg_trgm` |
| **DBeaver Community** or **pgAdmin 4** | Browsing the data by hand |
| **Bruno** (open source) | API collection for every endpoint, committed to the repo |
| **Android Studio** emulator, plus **Expo Go** or a dev build | Running the app |
| **ESLint** + **Prettier** (or **Biome**) | Lint and format |
| VS Code extensions: ESLint, Prettier, Expo Tools, PostgreSQL | Editor support |

### 6.6 Testing

| Layer | Tool |
| --- | --- |
| API unit and route tests | **Vitest** + `fastify.inject` |
| DB constraint tests (120 s reel, self-follow, comment on nothing) | Vitest against a `doshomik_test` database |
| Mobile components | **jest-expo** + **@testing-library/react-native** |
| Mobile end-to-end flows (sign up, post, follow, read a paper) | **Maestro** (open-source CLI, YAML flows), plus Mobile MCP for Claude-driven checks |
| Admin end-to-end | **Playwright** |

---

## 7. Feature → toolkit map

| v1 feature | Skills and agents | MCP | Key libraries |
| --- | --- | --- | --- |
| Sign up and log in, edit profile, profile page | `doshomik-api-endpoint`, `doshomik-ui`, `security-review`, `signup` | Postgres, Mobile | argon2, @fastify/jwt, expo-secure-store, react-hook-form, zod |
| Create post (text, image, reel ≤ 90 s) | `doshomik-media-upload`, `security-review` | Redis, Mobile | expo-image-picker, @fastify/multipart, ffprobe, BullMQ, FFmpeg |
| Home feed (following, newest first) | `rn-performance-reviewer`, `schema-guardian` | Postgres (`EXPLAIN`) | FlashList, TanStack Query, cursor pagination |
| Reels page | `rn-performance-reviewer`, `frontend-design` | Mobile, Context7 | expo-video, FlashList paging, Reanimated |
| Like, comment, reply, follow | `doshomik-api-endpoint` | Postgres | TanStack Query optimistic updates, expo-haptics |
| Notifications and unread count | `doshomik-api-endpoint` | Postgres | Notification row inserted in the same transaction as the action; polling or refetch on focus (no websockets in v1) |
| Learn: items, courses, external courses | `doshomik-ui` | Mobile | expo-video, expo-image, expo-web-browser |
| Practice: MCQ and short answer, topic or random | `doshomik-ui` | Postgres | `ORDER BY random()` with `LIMIT` (fine at v1 volume); short answers compared after trimming and case-folding |
| Research list, filter, search, paper page | `doshomik-ui`, `frontend-design` | Postgres | FlashList, expo-image (figures from `figures` jsonb) |
| Learn first | `schema-guardian` | Postgres | The doc's `LEFT JOIN` query, unchanged |
| Save and track (saved → reading → completed) | `doshomik-api-endpoint` | Postgres | Upsert on `user_papers` |
| Starting roadmap | `doshomik-ui` | Postgres | `roadmap_steps` ordered by `position` |
| Paper discussion | Reuses the comments endpoint | — | Same comment components as posts |
| Global search | `schema-guardian` | Postgres | pg_trgm, tsvector, one grouped endpoint |
| Admin content CMS | `frontend-design`, `security-review` | Playwright | Vite, shadcn/ui, TanStack Table, dnd-kit |
| Bilingual UI throughout | `doshomik-i18n`, `i18n-auditor` | — | i18next, Noto Sans Bengali |

---

## 8. Suggested build order

Each step ends with `doshomik-feature-check`: tests pass, the feature runs in the emulator, and `code-review` comes back clean.

1. **Foundation:** monorepo, shared package, Postgres plus migration 001, Fastify skeleton, Expo app with theme, i18n, fonts, five tabs, and the `components/ui` primitives.
2. **Accounts:** sign up, log in, profile, edit profile, avatar upload. Then run `security-review`.
3. **Admin CMS core:** admin auth, topics, fields, learn items, courses, questions, papers, roadmaps. Seed about 50 papers.
4. **Learn**, then **Practice**. These are read-only on mobile and come quickly once the admin has seeded content.
5. **Research:** list, filter, paper page, Learn first, save and track, roadmap.
6. **Social:** follow, text and image posts, Home feed, likes, comments and replies, paper discussion.
7. **Reels:** upload pipeline (ffprobe, BullMQ, FFmpeg), Reels page, reels on profile. Then `security-review` on uploads.
8. **Notifications** and **global search**.
9. **Polish pass:** loading, empty, error and offline states on every list; font scale at 200%; contrast in both themes; a `rn-performance-reviewer` sweep; Maestro flows for the eight user flows in the Prototype v1 doc.

---

## 9. Windows setup notes

- **PostgreSQL:** use the EDB Windows installer (16+). `pg_trgm` ships with it.
- **FFmpeg:** `winget install Gyan.FFmpeg`, or the `ffmpeg-static` and `ffprobe-static` npm packages to pin a version per repo.
- **Redis without Docker:** run Redis inside **WSL2** (`sudo apt install redis-server`), or install **Memurai Developer** (free, native Windows). BullMQ connects to `localhost:6379` either way.
- **uv** (for the Postgres and Redis MCP servers): `winget install astral-sh.uv`.
- **MCP and npx:** on native Windows, use `cmd /c npx …` in `claude mcp add` commands.
- **Android:** Android Studio with one Pixel emulator image. Test on a low-RAM profile too, since the target is a cheap Android phone.

---

## 10. Not needed in v1

Docker and Docker Compose, Caddy, GitHub Actions deploy, S3 or R2 SDKs, a CDN, Meilisearch or Elasticsearch, websockets, push notifications (in-app bell only), GROBID and scholarly-API paper ingestion, LLM APIs and the `claude-api` skill, hosted auth services, Sentry, and EAS Build (a local `expo run:android` or Expo Go is enough). Each one comes in when the stack moves from local prototype to the VPS deployment in `stack-v1.txt`.
