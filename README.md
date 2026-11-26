# Doshomik Bytes

A bilingual (Bangla/English) social learning app for ML, AI and research. Android first, going to
the Google Play Store, then to a Hostinger VPS with its own domains.

| Part | Where | Stack |
| --- | --- | --- |
| API + background worker | [`apps/api`](apps/api/README.md) | Node.js, Fastify, PostgreSQL, Kysely |
| Android app | [`apps/mobile`](apps/mobile/README.md) | React Native, Expo SDK 58, Expo Router |
| Shared constants and types | `packages/shared` | TypeScript |
| Admin dashboard | not built yet | React |

---

## Running it (everyday commands)

> **Windows: use PowerShell, not Git Bash.** Git Bash's lowercase `e:\` working directory makes
> Metro build a doubled path (`e:\E:\Projects\…`) and bundling fails.

**Terminal 1 — backend**

```powershell
cd E:\Projects\money\doshomik-bytes\apps\api
pnpm db:up      # start the database (once per reboot; safe to re-run)
pnpm dev        # API on http://localhost:3000
```

**Terminal 2 — app**

```powershell
cd E:\Projects\money\doshomik-bytes\apps\mobile
pnpm start      # then scan the QR code with Expo Go
```

**Terminal 3 — worker**, only when testing media uploads, notifications or paper ingestion:

```powershell
cd E:\Projects\money\doshomik-bytes\apps\api
pnpm worker
```

The app's placeholder home screen shows whether it reached the API.

---

## The database needs no password

`pnpm db:up` runs the project's **own** PostgreSQL cluster on port **55433**, created with `trust`
authentication, so it never asks for a password and there is no role to manage. It ignores whatever
PostgreSQL service is installed on the machine and never touches it. Its files live in
`E:\Projects\doshomik-dev-data`, outside the repo.

| Command | What it does |
| --- | --- |
| `pnpm db:up` | Start it. Creates the cluster and databases on the first run |
| `pnpm db:down` | Stop it |
| `pnpm db:status` | Running or not |
| `pnpm db:reset` | Delete everything and start empty |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Admin account, dev users and starter content |
| `pnpm db:types` | Regenerate `src/db/types.ts` from the live schema |

All of these run from `apps/api`. It is real PostgreSQL, so everything behaves as it will in
production on the VPS or on Supabase.

## First-time setup on a new machine

```powershell
pnpm install                                   # from the repo root
cd apps\api
Copy-Item .env.example .env                    # then set APP_SECRET and SEED_ADMIN_PASSWORD
pnpm db:up ; pnpm db:migrate ; pnpm db:seed
cd ..\mobile
Copy-Item .env.example .env                    # then set EXPO_PUBLIC_API_URL
```

Needs Node.js 22+, pnpm, PostgreSQL 18 binaries at `E:\PostgreSQL\bin` (set `PG_BIN` if elsewhere)
and FFmpeg on `PATH`.

### Connecting a phone

The phone and this computer must be on the same Wi-Fi. `EXPO_PUBLIC_API_URL` in
`apps/mobile/.env` and `PUBLIC_URL` in `apps/api/.env` must both point at this computer's LAN IP
(currently `http://192.168.0.100:3000`). If the IP changes after a reboot, run `ipconfig` and update
both. If the app loads but cannot reach the API, allow the ports once in an Administrator
PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Doshomik dev" -Direction Inbound -Protocol TCP -LocalPort 3000,8081 -Action Allow -Profile Private
```

## Checks

```powershell
pnpm typecheck                     # from the repo root: api + mobile
cd apps\api   ; pnpm test          # 58 tests, on its own wiped database
cd apps\mobile; pnpm doctor        # Expo config and dependency check
```

## Docs

| File | What it covers |
| --- | --- |
| `docs/Prototype v1 — Features, User Flows & Database Schema.md` | Original scope. The source of truth; never edited |
| `docs/Prototype 2 — Features, Database, Security & Efficiency.md` | The scope the backend is built from |
| `docs/prototype-2-implementation-notes.md` | Decisions made, and what is deferred with the steps to finish it |
| `docs/project-context.md` | Product overview and the UI/UX specification |
| `docs/architecture/` | Backend and database architecture |
| `apps/api/README.md` | Every API endpoint |
| `apps/mobile/README.md` | App setup, build profiles, device builds |

## House rules

- **The owner does all git committing.** Nothing is committed, pushed, staged or branched for them.
- Authentication is **switched off during development** (`DEV_AUTH_BYPASS=true`): requests without a
  token act as `admin`, or as the user in an `x-dev-user` header. Sign-in, permissions and password
  flows are built and tested at the very end. The checklist for turning it back on is in
  `docs/prototype-2-implementation-notes.md` §2.8.
- Build feature by feature, and test each one before starting the next.
