import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { LEARN_VIDEO_MAX_SECONDS, REEL_MAX_SECONDS } from '@doshomik/shared';
import type { Selectable } from 'kysely';
import type { Logger } from 'pino';
import sharp, { type Metadata } from 'sharp';
import { env } from '../config/env';
import { db } from '../db';
import type { MediaAssets } from '../db/types';
import { emit } from '../lib/outbox';
import { storage } from '../lib/storage';

// The media pipeline's slow half. Assets marked `processing` (by POST /v1/media/:id/complete) are
// this worker's queue: it checks the real file, strips metadata, makes image variants or an HLS
// ladder, and marks the asset ready or failed.

const execFileAsync = promisify(execFile);
const workRoot = path.resolve(env.MEDIA_DIR, 'work');

type Asset = Selectable<MediaAssets>;
interface Processed {
  playback_key: string;
  thumbnail_key: string;
  width: number;
  height: number;
  duration_ms: number | null;
}

/** A problem with the user's file (wrong type, too long). Shown to the user as the asset's error. */
class MediaRejected extends Error {}

/** Where an asset's processed files live. Post media is private (signed URLs); the rest is public. */
export function processedPrefix(purpose: string, publicId: string): string {
  return purpose === 'post' ? `posts/${publicId}/` : `public/${purpose}/${publicId}/`;
}

/** Processes the oldest waiting asset. Returns false when the queue is empty. */
export async function processNextMedia(log: Logger): Promise<boolean> {
  const asset = await db
    .selectFrom('media_assets')
    .selectAll()
    .where('status', '=', 'processing')
    .orderBy('updated_at')
    .limit(1)
    .executeTakeFirst();
  if (!asset) return false;

  const workDir = path.join(workRoot, asset.public_id);
  const raw = await storage.openRaw(asset.raw_key!);
  try {
    await mkdir(workDir, { recursive: true });
    const result = asset.kind === 'image' ? await processImage(asset, raw.path, workDir) : await processVideo(asset, raw.path, workDir);
    await storage.putProcessed(workDir, processedPrefix(asset.purpose, asset.public_id));

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('media_assets')
        .set({ ...result, status: 'ready', error: null, updated_at: new Date() })
        .where('id', '=', asset.id)
        .execute();
      await emit(trx, 'media.ready', asset.id, {});
    });
    log.info({ mediaId: asset.public_id, kind: asset.kind }, 'Media ready');
  } catch (error) {
    const message = error instanceof MediaRejected ? error.message : 'Processing failed. Try uploading again.';
    if (!(error instanceof MediaRejected)) log.error({ err: error, mediaId: asset.public_id }, 'Media processing crashed');
    await db.updateTable('media_assets').set({ status: 'failed', error: message, updated_at: new Date() }).where('id', '=', asset.id).execute();
  } finally {
    // The original (with its GPS and camera metadata) is not kept once processing ends.
    await raw.release();
    await storage.deleteRaw(asset.raw_key!);
    await rm(workDir, { recursive: true, force: true });
  }
  return true;
}

// ---------- Images: WebP variants, metadata stripped ----------

const IMAGE_VARIANTS = [
  { name: 'thumb.webp', size: 320 },
  { name: 'feed.webp', size: 1080 },
  { name: 'full.webp', size: 2048 },
];

async function processImage(asset: Asset, file: string, workDir: string): Promise<Processed> {
  let metadata: Metadata;
  try {
    metadata = await sharp(file).metadata();
  } catch {
    throw new MediaRejected('File is not a readable image');
  }
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new MediaRejected('Use a JPEG, PNG or WebP image');

  // rotate() applies the EXIF orientation. sharp writes no metadata unless asked, so GPS and camera data are dropped.
  for (const variant of IMAGE_VARIANTS) {
    await sharp(file)
      .rotate()
      .resize({ width: variant.size, height: variant.size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(path.join(workDir, variant.name));
  }

  const sideways = (metadata.orientation ?? 1) >= 5; // EXIF 5–8 swap width and height
  const prefix = processedPrefix(asset.purpose, asset.public_id);
  return {
    playback_key: prefix, // folder holding thumb, feed and full
    thumbnail_key: `${prefix}thumb.webp`,
    width: (sideways ? metadata.height : metadata.width) ?? 0,
    height: (sideways ? metadata.width : metadata.height) ?? 0,
    duration_ms: null,
  };
}

// ---------- Video: HLS ladder (H.264 + AAC) and a poster ----------

/** Renditions by the short side of the frame, so portrait reels and landscape videos both fit. */
const LADDER = [
  { short: 360, kbps: 800 },
  { short: 540, kbps: 1400 },
  { short: 720, kbps: 2500 },
  { short: 1080, kbps: 4500 },
];

interface Probe {
  width: number;
  height: number;
  seconds: number;
  hasAudio: boolean;
}

async function probe(file: string): Promise<Probe> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      env.FFPROBE_PATH,
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:stream_side_data=rotation:format=duration', '-of', 'json', file],
      { timeout: 60_000 },
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`ffprobe not found at "${env.FFPROBE_PATH}"`);
    throw new MediaRejected('File is not a readable video');
  }
  const info = JSON.parse(stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number; side_data_list?: { rotation?: number }[] }[];
    format?: { duration?: string };
  };
  const video = info.streams?.find((s) => s.codec_type === 'video');
  const seconds = Number(info.format?.duration);
  if (!video?.width || !video.height || !Number.isFinite(seconds) || seconds <= 0) throw new MediaRejected('File is not a readable video');

  // Phones store portrait video as landscape plus a rotation; ffmpeg applies it, so measure the shown frame.
  const rotation = Math.abs(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0) % 180;
  return {
    width: rotation === 90 ? video.height : video.width,
    height: rotation === 90 ? video.width : video.height,
    seconds,
    hasAudio: Boolean(info.streams?.some((s) => s.codec_type === 'audio')),
  };
}

const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);

async function processVideo(asset: Asset, file: string, workDir: string): Promise<Processed> {
  const video = await probe(file);
  const maxSeconds = asset.purpose === 'post' ? REEL_MAX_SECONDS : LEARN_VIDEO_MAX_SECONDS;
  if (video.seconds > maxSeconds) {
    throw new MediaRejected(asset.purpose === 'post' ? `Reels can be at most ${maxSeconds} seconds long` : `Videos can be at most ${maxSeconds / 60} minutes long`);
  }

  const portrait = video.height > video.width;
  const shortSide = Math.min(video.width, video.height);
  const longSide = Math.max(video.width, video.height);
  const rungs = LADDER.filter((rung) => rung.short <= shortSide);
  if (rungs.length === 0) rungs.push({ short: even(shortSide), kbps: 400 }); // smaller than 360p: keep its size

  const audio = video.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : [];
  const playlist = ['#EXTM3U', '#EXT-X-VERSION:3'];

  for (const rung of rungs) {
    const name = `${rung.short}p`;
    const scaledLong = even((longSide * rung.short) / shortSide);
    const [width, height] = portrait ? [rung.short, scaledLong] : [scaledLong, rung.short];
    await mkdir(path.join(workDir, name));
    await ffmpeg([
      '-i', file,
      '-map', '0:v:0', ...audio,
      '-map_metadata', '-1',
      '-vf', `scale=${width}:${height}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
      '-b:v', `${rung.kbps}k`, '-maxrate', `${Math.round(rung.kbps * 1.07)}k`, '-bufsize', `${Math.round(rung.kbps * 1.5)}k`,
      '-force_key_frames', 'expr:gte(t,n_forced*4)',
      '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(workDir, name, 'seg_%03d.ts'),
      path.join(workDir, name, 'index.m3u8'),
    ]);
    const bandwidth = (rung.kbps + (video.hasAudio ? 128 : 0)) * 1000;
    playlist.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height}`, `${name}/index.m3u8`);
  }
  await writeFile(path.join(workDir, 'master.m3u8'), `${playlist.join('\n')}\n`);

  const posterShort = Math.min(720, even(shortSide));
  await ffmpeg([
    '-ss', String(Math.min(1, video.seconds / 2)),
    '-i', file,
    '-frames:v', '1',
    '-map_metadata', '-1',
    '-vf', portrait ? `scale=${posterShort}:-2` : `scale=-2:${posterShort}`,
    path.join(workDir, 'poster.jpg'),
  ]);

  const prefix = processedPrefix(asset.purpose, asset.public_id);
  return {
    playback_key: `${prefix}master.m3u8`,
    thumbnail_key: `${prefix}poster.jpg`,
    width: video.width,
    height: video.height,
    duration_ms: Math.round(video.seconds * 1000),
  };
}

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(env.FFMPEG_PATH, ['-y', '-v', 'error', ...args], { timeout: 30 * 60_000, maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`ffmpeg not found at "${env.FFMPEG_PATH}"`);
    throw error;
  }
}
