---
name: doshomik-media-upload
description: How Doshomik Bytes uploads, processes and serves images and videos (signed direct uploads, the media worker, HLS, signed URLs). Use when adding a media purpose, changing limits, or touching storage or the media worker.
---

# Media pipeline in apps/api

Video bytes never pass through the API routes. The pieces:

| Step | Where |
| --- | --- |
| Upload slot: checks kind, purpose, MIME and size; inserts `media_assets` as `uploading`; returns a 15-minute signed PUT URL | `modules/media/media.service.ts` `createUpload` |
| Direct upload to raw storage (dev stand-in for S3/R2) | `PUT /storage/raw/:token` in `modules/media/storage.routes.ts` |
| Complete: the file must exist with the declared size; status becomes `processing` (that status is the worker's queue) | `completeUpload` |
| Worker: sharp WebP variants, or ffprobe check + HLS ladder + poster; metadata stripped; raw deleted; status `ready` or `failed` with a user-facing `error`; `media.ready` outbox event | `src/worker/media.ts` |
| Reacting to ready media: publish waiting posts with a `post_ready` notification, set avatars | `media.ready` handler in `src/worker/outbox.ts` |
| URLs in responses: `public/…` keys unsigned and immutable; `posts/…` keys signed per asset folder (about a day for public accounts, 1–2 h for private) | `mediaView` in `media.service.ts`, `storage.signedUrl` |

## Rules

- Limits live in one place each:
  - `REEL_MAX_SECONDS` (90) and `LEARN_VIDEO_MAX_SECONDS` in `@doshomik/shared`;
  - byte limits and MIME types in `media.service.ts`.
  Never trust durations or types the app sends; the worker measures them.
- New purpose: add it to `MEDIA_PURPOSES` (shared) and the `media_assets.purpose` CHECK (migration), `KINDS_BY_PURPOSE`, the staff check if it is team content, and `processedPrefix` (is it public?).
- The database stores **keys**, never full URLs, except `users.avatar_url` and `papers.figures`, which hold public URLs.
- Go through the `Storage` interface (`lib/storage.ts`), never `fs`, so S3/R2 or a managed video service can replace local disk (`docs/prototype-2-implementation-notes.md` §3.3).
- Post creation locks the media row (`FOR UPDATE`) so the worker can't mark it ready between the check and the insert.
- Abandoned uploads and purged posts' files are removed by `src/worker/maintenance.ts`.

## Testing

Use `upload(app, user, { kind, purpose, mimeType, bytes })` and `runWorker()` from `test/helpers.ts`. `test/media.test.ts` makes real videos with ffmpeg (`color` source) and checks HLS playback through signed URLs.
