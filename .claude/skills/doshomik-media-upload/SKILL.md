---
name: doshomik-media-upload
description: How Doshomik Bytes receives, validates and stores uploaded images and videos (posts, reels, avatars, admin media). Use when adding an upload endpoint or changing size, type or duration limits.
---

# Media uploads in apps/api

All of it is in `apps/api/src/lib/uploads.ts` and `apps/api/src/lib/storage.ts`. Don't add a second upload path.

## Flow

1. `readMultipart(request, ['image'] | ['video'] | ['image', 'video'])` reads the text fields and **at most one file**. It streams the file to `MEDIA_DIR/tmp` (never served). It rejects other MIME types (415) and oversized files (413: images 10 MB, videos 100 MB).
2. Validate the text fields with zod. On any error before storing, call `discardUpload(file)`.
3. `storeUpload(file, folder, { maxSeconds })` checks the **real content**:
   - images: JPEG, PNG or WebP file signature
   - videos: `ffprobe` must find a video stream and a duration; with `maxSeconds`, longer videos are rejected (`VIDEO_TOO_LONG`)

   It then moves the file into storage and returns `{ url, durationSeconds }`. It always removes the temp file.
4. Insert the row with the URL. If the insert fails, call `storage.remove(url)`.

## Limits and rules

- Reels are at most `REEL_MAX_SECONDS` (90) from `@doshomik/shared`. The same limit is enforced on the client, here, and by the DB `CHECK (duration_seconds BETWEEN 1 AND 90)`.
- One media file per post. Carousels are left out of v1.
- The database stores only the URL. The `Storage` interface (`save` and `remove`) is the seam for moving from local disk to the VPS or S3/R2 later. Keys are server-generated (`<folder>/<uuid>.<ext>`), never client file names.
- When a row that owns a file is deleted or replaced (post delete, new avatar), call `storage.remove(oldUrl)`.
- v1 has no transcoding queue (Redis, BullMQ and FFmpeg transcoding are not set up locally). Don't add one unless the owner asks.

## Testing

`apps/api/test/media.test.ts` uploads with `FormData` through `app.inject` and makes test videos with ffmpeg (`color` source, `-r 1`). Add a case for every new limit.
