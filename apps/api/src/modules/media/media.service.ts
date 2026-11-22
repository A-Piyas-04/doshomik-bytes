import { randomUUID } from 'node:crypto';
import type { MediaKind, MediaPurpose } from '@doshomik/shared';
import { db } from '../../db';
import { badRequest, conflict, forbidden, found, notFound } from '../../lib/errors';
import { storage } from '../../lib/storage';

const MB = 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

const MIME_TYPES: Record<MediaKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
};

/** Largest upload per kind and purpose. Learn videos run minutes, reels at most 90 seconds. */
function maxBytes(kind: MediaKind, purpose: MediaPurpose): number {
  if (kind === 'image') return 15 * MB;
  return purpose === 'learn' ? 1024 * MB : 150 * MB;
}

/** Avatars and paper figures are images; posts and learn items may be either. */
const KINDS_BY_PURPOSE: Record<MediaPurpose, MediaKind[]> = {
  post: ['image', 'video'],
  learn: ['image', 'video'],
  avatar: ['image'],
  paper_figure: ['image'],
};

/** Team-content purposes need an admin with two-factor sign-in, as staff routes do. */
const STAFF_PURPOSES: MediaPurpose[] = ['learn', 'paper_figure'];

/**
 * Step 1 of an upload: checks the declared file, records the asset as `uploading`, and returns a
 * short-lived URL the app uploads the bytes to directly. The bytes never pass through the API.
 */
export async function createUpload(
  owner: { userId: number; role: string; mfaEnabled: boolean },
  input: { kind: MediaKind; purpose: MediaPurpose; mime_type: string; size_bytes: number },
) {
  if (STAFF_PURPOSES.includes(input.purpose) && !(owner.role === 'admin' && owner.mfaEnabled)) {
    throw forbidden('Only admins can upload team content');
  }
  if (!KINDS_BY_PURPOSE[input.purpose].includes(input.kind)) {
    throw badRequest(`A ${input.purpose.replace('_', ' ')} must be ${KINDS_BY_PURPOSE[input.purpose].join(' or ')}`);
  }
  if (!MIME_TYPES[input.kind].includes(input.mime_type)) {
    throw badRequest(`Allowed ${input.kind} types: ${MIME_TYPES[input.kind].join(', ')}`, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const limit = maxBytes(input.kind, input.purpose);
  if (input.size_bytes > limit) throw badRequest(`File is larger than ${limit / MB} MB`, 'FILE_TOO_LARGE');

  const publicId = randomUUID();
  const rawKey = `uploads/${publicId}`;
  await db
    .insertInto('media_assets')
    .values({
      public_id: publicId,
      owner_id: owner.userId,
      kind: input.kind,
      purpose: input.purpose,
      raw_key: rawKey,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
    })
    .execute();

  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
  return {
    media: { id: publicId, status: 'uploading' as const },
    upload: {
      method: 'PUT' as const,
      url: storage.createUploadUrl(rawKey, { contentType: input.mime_type, maxBytes: input.size_bytes, expiresAt }),
      headers: { 'content-type': input.mime_type },
      expires_at: expiresAt.toISOString(),
    },
  };
}

/**
 * Step 2: the app says the upload finished. The file must exist with the declared size. The asset
 * then waits as `processing`, which is the worker's queue.
 */
export async function completeUpload(ownerId: number, mediaPublicId: string) {
  const asset = await findOwnAsset(ownerId, mediaPublicId);
  if (asset.status !== 'uploading') throw conflict(`Upload is already ${asset.status}`, 'UPLOAD_NOT_PENDING');

  const size = await storage.rawSize(asset.raw_key!);
  if (size === null) throw conflict('Nothing was uploaded yet', 'UPLOAD_MISSING');
  if (size !== asset.size_bytes) {
    await storage.deleteRaw(asset.raw_key!);
    throw badRequest('Uploaded file size does not match the declared size', 'SIZE_MISMATCH');
  }

  await db
    .updateTable('media_assets')
    .set({ status: 'processing', updated_at: new Date() })
    .where('id', '=', asset.id)
    .execute();
  return getOwnMedia(ownerId, mediaPublicId);
}

/** The owner's view of an asset, including the error when processing failed. */
export async function getOwnMedia(ownerId: number, mediaPublicId: string) {
  const asset = await findOwnAsset(ownerId, mediaPublicId);
  return { ...mediaView(asMediaColumns(asset), { private: true })!, purpose: asset.purpose, error: asset.error };
}

async function findOwnAsset(ownerId: number, mediaPublicId: string) {
  const asset = found(
    await db.selectFrom('media_assets').selectAll().where('public_id', '=', mediaPublicId).executeTakeFirst(),
    'Media',
  );
  if (asset.owner_id !== ownerId) throw notFound('Media'); // 404, not 403: don't confirm it exists
  return asset;
}

// ---------- Presenting media in API responses ----------

/** The media_assets columns `mediaView` needs, selected from alias `m` in a joined query. */
export const MEDIA_COLUMNS = [
  'm.public_id as media_id',
  'm.kind as media_kind',
  'm.status as media_status',
  'm.provider as media_provider',
  'm.playback_key as media_playback_key',
  'm.thumbnail_key as media_thumbnail_key',
  'm.width as media_width',
  'm.height as media_height',
  'm.duration_ms as media_duration_ms',
] as const;

export interface MediaColumns {
  media_id: string | null;
  media_kind: string | null;
  media_status: string | null;
  media_provider: string | null;
  media_playback_key: string | null;
  media_thumbnail_key: string | null;
  media_width: number | null;
  media_height: number | null;
  media_duration_ms: number | null;
}

export interface MediaView {
  id: string;
  kind: string;
  status: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  /** Image: the feed-size WebP. Video: the HLS master playlist. Null until ready. */
  url: string | null;
  thumbnail_url: string | null;
  /** Images only: the full-size WebP. */
  full_url: string | null;
}

function asMediaColumns(asset: {
  public_id: string;
  kind: string;
  status: string;
  provider: string;
  playback_key: string | null;
  thumbnail_key: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
}): MediaColumns {
  return {
    media_id: asset.public_id,
    media_kind: asset.kind,
    media_status: asset.status,
    media_provider: asset.provider,
    media_playback_key: asset.playback_key,
    media_thumbnail_key: asset.thumbnail_key,
    media_width: asset.width,
    media_height: asset.height,
    media_duration_ms: asset.duration_ms,
  };
}

/**
 * Builds the URLs for an asset. Keys under "public/" get plain cacheable URLs. Post media gets
 * signed URLs: valid about a day for public accounts (so CDNs can cache them), one to two hours
 * for private ones.
 */
export function mediaView(m: MediaColumns, options: { private: boolean }): MediaView | null {
  if (!m.media_id) return null;
  const view: MediaView = {
    id: m.media_id,
    kind: m.media_kind!,
    status: m.media_status!,
    width: m.media_width,
    height: m.media_height,
    duration_seconds: m.media_duration_ms === null ? null : Math.round(m.media_duration_ms / 1000),
    url: null,
    thumbnail_url: null,
    full_url: null,
  };
  if (m.media_status !== 'ready' || !m.media_playback_key) return view;
  if (m.media_provider === 'legacy') return { ...view, url: m.media_playback_key }; // a Prototype 1 URL

  const urlOf = (key: string) => {
    if (key.startsWith('public/')) return storage.publicUrl(key);
    const scope = `${key.split('/').slice(0, 2).join('/')}/`; // "posts/<asset id>/"
    return storage.signedUrl(key, scope, signedUrlExpiry(options.private));
  };

  if (m.media_kind === 'image') {
    const base = m.media_playback_key; // a folder holding thumb, feed and full variants
    return { ...view, url: urlOf(`${base}feed.webp`), thumbnail_url: urlOf(`${base}thumb.webp`), full_url: urlOf(`${base}full.webp`) };
  }
  return {
    ...view,
    url: urlOf(m.media_playback_key),
    thumbnail_url: m.media_thumbnail_key ? urlOf(m.media_thumbnail_key) : null,
  };
}

/** Replaces a row's media_* columns with one `media` object. */
export function withMediaView<T extends MediaColumns>(row: T, options: { private: boolean }) {
  const {
    media_id: _id,
    media_kind: _kind,
    media_status: _status,
    media_provider: _provider,
    media_playback_key: _playback,
    media_thumbnail_key: _thumbnail,
    media_width: _width,
    media_height: _height,
    media_duration_ms: _duration,
    ...rest
  } = row;
  return { ...rest, media: mediaView(row, options) };
}

/** Rounded up to the next hour or day, so the same URL repeats and stays cacheable within that window. */
function signedUrlExpiry(isPrivate: boolean): Date {
  const unit = isPrivate ? 3600_000 : 86_400_000;
  return new Date(Math.ceil(Date.now() / unit) * unit + unit);
}
