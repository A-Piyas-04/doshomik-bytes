# Doshomik Bytes — mobile app

The Android app: React Native + Expo (SDK 58) + TypeScript, with Expo Router.

The full product UI is built: Home (Feed and Research), Learn with Practice,
Explore, Reels and Profile, in English and Bangla, light and dark. The design
and every decision are in
[`docs/frontend-implementation-notes.md`](../../docs/frontend-implementation-notes.md);
the UI spec is [`docs/project-context.md`](../../docs/project-context.md) §2.

Sign-in is not built yet (the owner's "auth last" rule): the API runs with
`DEV_AUTH_BYPASS`, and in development Settings › "Act as" switches between the
seeded accounts (admin, learner1, learner2).

## Setup

```sh
pnpm install              # from the repo root
cd apps/mobile
cp .env.example .env      # then set EXPO_PUBLIC_API_URL for your device
pnpm start                # Metro dev server
```

Run the API in another terminal (`cd apps/api && pnpm dev`, plus `pnpm worker`
for media processing). For data, the API's database needs `pnpm db:migrate` and
`pnpm db:seed`, which fills every screen.

### Web build (for checking screens on a computer)

```powershell
$env:EXPO_PUBLIC_API_URL='http://localhost:3000'; npx expo start --web
```

Start the API with `CORS_ORIGINS=http://localhost:8081` (and
`PUBLIC_URL=http://localhost:3000` so media links resolve). The web build is for
QA only; the product is the Android app. If Metro misses newly added route
files, restart it with `--clear`.

> **Windows:** run Expo commands from PowerShell, not Git Bash. Git Bash's
> lowercase `e:\` working directory makes Metro build a doubled path
> (`e:\E:\Projects\…`) and bundling fails.

## Seeing it on a phone

Expo Go is not an option for SDK 58 (the matching Expo Go is not in the stores
yet), so a **development build** is needed. Build it once, then every code
change reloads over Wi-Fi without rebuilding. All native modules the app uses
are already installed, so one build covers everything built so far; rebuild
only after adding a native dependency.

```sh
npx eas-cli@latest login                                            # free Expo account
npx eas-cli@latest init                                             # once: links the project
npx eas-cli@latest build --platform android --profile development    # ~10-20 min in the cloud
```

Install the resulting APK on the phone, then `pnpm start` and scan the QR code.
The phone and this computer must be on the same Wi-Fi.

A local build instead of the cloud needs the Android SDK platform 36 and the
NDK (several GB) plus `ANDROID_HOME`. This machine has only platform 35 and no
NDK, so the cloud build is the shorter path.

### Build profiles (`eas.json`)

| Profile | Output | Package id | For |
| --- | --- | --- | --- |
| `development` | APK with the dev client | `com.doshomik.bytes.dev` | Daily development on a device |
| `preview` | Plain APK | `com.doshomik.bytes.preview` | Giving a testable build to someone |
| `production` | AAB | `com.doshomik.bytes` | Play Store |

The three use different package ids, so all three can sit on one phone at once.
`APP_VARIANT` selects them in [`app.config.ts`](app.config.ts).

`appVersionSource` is `remote`, so Expo's servers own `versionCode` and
`production` increments it per build. The `version` string in `app.json` is
still bumped by hand.

**Before the first preview or production build:** set `EXPO_PUBLIC_API_URL` for
that profile in `eas.json` (or as an EAS environment variable). Those builds
bake the URL in, unlike development builds, which read it from Metro.

## Layout

```
src/
  app/            Expo Router routes. Every file here is a screen; _layout.tsx files are navigators.
    _layout.tsx   Root stack
    index.tsx     Placeholder home screen
  config.ts       Resolves API_URL. The only place a host is decided.
assets/images/    App icon, adaptive icon, splash
app.json          Static Expo config (slug, version, icons, plugins)
app.config.ts     Per-variant name and Android package id
eas.json          Build profiles
```

## Conventions

- **No hardcoded hosts.** Everything environment-specific goes through
  `src/config.ts` and `EXPO_PUBLIC_*`, so dev, preview and the VPS differ only
  by configuration.
- **`EXPO_PUBLIC_*` is public.** It is inlined into the app bundle at build
  time and anyone can read it. Secrets stay on the server.
- **Never edit `android/` or `ios/`.** They are generated (Continuous Native
  Generation). Native behaviour is configured in `app.json` and config plugins.
- **`npx expo install <pkg>`**, never a plain `pnpm add`, so versions stay
  SDK-compatible.
- **Every string goes through `t()`.** Add the key to `src/i18n/en.ts` and
  `bn.ts`; a missing Bangla key fails typecheck.
- **Colours, sizes and fonts come from `src/theme/`.** No literals in screens.
- **Text is `AppText`**, which picks the Bangla or Latin font per script run.
- Run `pnpm typecheck`, `pnpm lint` and `pnpm doctor` before calling anything done.

## Decisions taken while scaffolding (26 Nov 2026)

| Decision | Why |
| --- | --- |
| Expo SDK 58 from the `default@sdk-58` template | Latest stable (Oct 2026). `create-expo-app` still defaults to SDK 57, so the template is pinned explicitly |
| Android package `com.doshomik.bytes`, version `0.1.0` | Confirmed by the owner on 26 Nov 2026. It is the permanent Play Store identity and **cannot be changed after the first release** |
| Expo Router (file-based routing) | The template default, and what the Expo docs target |
| JavaScript `Tabs` planned, not `NativeTabs` | The five-tab bar needs exact control of icons and colours per state; the Expo docs say native tabs follow platform behaviour and are not a drop-in |
| Template demo code, `expo-glass-effect` and `expo-symbols` removed | Glass effects are banned by the design rules. (Web support and `@expo/ui` came back with the UI build: web for screenshot QA, `@expo/ui` as an installed fallback for native sheets) |
| Expo's MIT `LICENSE` file deleted | It covered the template, not this proprietary product |
| `AGENTS.md` kept from the template | Its Expo-specific guidance (check versioned docs, CNG, `expo install`) is accurate and useful |
