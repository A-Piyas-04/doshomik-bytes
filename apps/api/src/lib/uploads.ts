import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import { env } from '../config/env';
import { badRequest, HttpError } from './errors';
import { storage, uploadTempDir } from './storage';

export type MediaKind = 'image' | 'video';

const MB = 1024 * 1024;
const MAX_BYTES: Record<MediaKind, number> = { image: 10 * MB, video: 100 * MB };

const EXTENSIONS: Record<MediaKind, Record<string, string>> = {
  image: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  video: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' },
};

/** A received file in the temp folder. Pass it to `storeUpload`, or `discardUpload` it. */
export interface Upload {
  tempPath: string;
  kind: MediaKind;
  extension: string;
}

export interface StoredMedia {
  url: string;
  /** Rounded video length; null for images. */
  durationSeconds: number | null;
}

/** Reads a multipart body: its text fields and at most one file of an accepted kind. */
export async function readMultipart(
  request: FastifyRequest,
  accept: MediaKind[],
): Promise<{ fields: Record<string, string>; file?: Upload }> {
  if (!request.isMultipart()) throw badRequest('Expected a multipart/form-data body');

  const fields: Record<string, string> = {};
  let file: Upload | undefined;
  const fileSize = Math.max(...accept.map((kind) => MAX_BYTES[kind]));

  try {
    for await (const part of request.parts({ limits: { files: 1, fields: 10, fileSize } })) {
      if (part.type === 'field') {
        if (typeof part.value === 'string') fields[part.fieldname] = part.value;
        continue;
      }
      const kind = accept.find((k) => part.mimetype in EXTENSIONS[k]);
      if (!kind) throw unsupportedType(accept);

      await mkdir(uploadTempDir, { recursive: true });
      file = { tempPath: path.join(uploadTempDir, randomUUID()), kind, extension: EXTENSIONS[kind][part.mimetype]! };
      await pipeline(part.file, createWriteStream(file.tempPath));

      if ((await stat(file.tempPath)).size > MAX_BYTES[kind]) {
        throw new HttpError(413, 'FILE_TOO_LARGE', `File is larger than ${MAX_BYTES[kind] / MB} MB`);
      }
    }
  } catch (error) {
    await discardUpload(file);
    throw error;
  }

  return { fields, file };
}

/**
 * Checks the file's real content (image signature, or a readable video via ffprobe)
 * and moves it into storage under `folder`. The temp file is always removed.
 */
export async function storeUpload(
  upload: Upload,
  folder: string,
  options: { maxSeconds?: number } = {},
): Promise<StoredMedia> {
  try {
    let durationSeconds: number | null = null;

    if (upload.kind === 'image') {
      await assertImageSignature(upload);
    } else {
      const duration = await probeVideoDuration(upload.tempPath);
      if (options.maxSeconds !== undefined && duration > options.maxSeconds) {
        throw badRequest(`Video is longer than ${options.maxSeconds} seconds`, 'VIDEO_TOO_LONG');
      }
      durationSeconds = Math.max(1, Math.round(duration));
    }

    const url = await storage.save(upload.tempPath, `${folder}/${randomUUID()}.${upload.extension}`);
    return { url, durationSeconds };
  } finally {
    await discardUpload(upload);
  }
}

export async function discardUpload(upload: Upload | undefined): Promise<void> {
  if (upload) await rm(upload.tempPath, { force: true });
}

function unsupportedType(accept: MediaKind[]): HttpError {
  const allowed = accept.flatMap((kind) => Object.keys(EXTENSIONS[kind])).join(', ');
  return new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', `Allowed file types: ${allowed}`);
}

const IMAGE_SIGNATURES: Record<string, (header: Buffer) => boolean> = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

/** The client-sent MIME type can lie; the first bytes of the file cannot. */
async function assertImageSignature(upload: Upload): Promise<void> {
  const handle = await open(upload.tempPath, 'r');
  try {
    const header = Buffer.alloc(12);
    await handle.read(header, 0, header.length, 0);
    if (!IMAGE_SIGNATURES[upload.extension]?.(header)) {
      throw badRequest('File content does not match its image type', 'INVALID_IMAGE');
    }
  } finally {
    await handle.close();
  }
}

const execFileAsync = promisify(execFile);

/** Returns the video's length in seconds, or rejects a file ffprobe cannot read as video. */
async function probeVideoDuration(filePath: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      env.FFPROBE_PATH,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', filePath],
      { timeout: 15_000 },
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`ffprobe not found at "${env.FFPROBE_PATH}". Install FFmpeg or set FFPROBE_PATH.`);
    }
    throw badRequest('File is not a readable video', 'INVALID_VIDEO');
  }

  const info = JSON.parse(stdout) as { streams?: unknown[]; format?: { duration?: string } };
  const duration = Number(info.format?.duration);
  if (!info.streams?.length || !Number.isFinite(duration) || duration <= 0) {
    throw badRequest('File is not a readable video', 'INVALID_VIDEO');
  }
  return duration;
}
