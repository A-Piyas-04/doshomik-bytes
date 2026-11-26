# Doshomik Bytes — mobile app

The Android app: React Native + Expo (SDK 58) + TypeScript, with Expo Router.

Right now this is **scaffold only**. There is one placeholder screen that shows
whether the API is reachable. No product UI is built yet; it is built from
`docs/project-context.md` §2 once the design details are settled.

## Setup

```sh
pnpm install              # from the repo root
cd apps/mobile
cp .env.example .env      # then set EXPO_PUBLIC_API_URL for your device
pnpm start                # Metro dev server
```

Run the API in another terminal (`cd apps/api && pnpm dev`), or the placeholder
screen reports it as unreachable.

> **Windows:** run Expo commands from PowerShell, not Git Bash. Git Bash's
> lowercase `e:\` working directory makes Metro build a doubled path
> (`e:\E:\Projects\…`) and bundling fails.

## Seeing it on a phone

Expo Go is not an option for SDK 58 (the matching Expo Go is not in the stores
yet), so a **development build** is needed. Build it once, then every code
change reloads over Wi-Fi without rebuilding.

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
- Run `pnpm typecheck` and `pnpm doctor` before calling anything done.

## Decisions taken while scaffolding (26 Nov 2026)

| Decision | Why |
| --- | --- |
| Expo SDK 58 from the `default@sdk-58` template | Latest stable (Oct 2026). `create-expo-app` still defaults to SDK 57, so the template is pinned explicitly |
| Android package `com.doshomik.bytes`, version `0.1.0` | Confirmed by the owner on 26 Nov 2026. It is the permanent Play Store identity and **cannot be changed after the first release** |
| Expo Router (file-based routing) | The template default, and what the Expo docs target |
| JavaScript `Tabs` planned, not `NativeTabs` | The five-tab bar needs exact control of icons and colours per state; the Expo docs say native tabs follow platform behaviour and are not a drop-in |
| Template demo code, web support, `@expo/ui`, `expo-glass-effect` and `expo-symbols` removed | Android-only target; glass effects are banned by the design rules. Also keeps the install small |
| Expo's MIT `LICENSE` file deleted | It covered the template, not this proprietary product |
| `AGENTS.md` kept from the template | Its Expo-specific guidance (check versioned docs, CNG, `expo install`) is accurate and useful |
