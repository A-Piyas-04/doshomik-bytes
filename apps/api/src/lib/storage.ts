import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env';
import { signToken } from './crypto';
import { HttpError } from './errors';

/**
 * Object storage with the two areas the doc describes:
 * - raw: original uploads. Private; written only through short-lived signed upload URLs.
 * - processed: worker output. Keys under "public/" (avatars, learn media, paper figures) get plain,
 *   cacheable URLs. Everything else (post media) is reachable only through signed URLs, so a
 *   private account's media stops being reachable once its links expire.
 *
 * The database stores keys, never URLs, so moving to S3/R2 behind a CDN means a new
 * implementation of this interface and no data change.
 */
export interface Storage {
  createUploadUrl(rawKey: string, options: { contentType: string; maxBytes: number; expiresAt: Date }): string;
  /** Size in bytes of an uploaded raw file, or null if nothing was uploaded. */
  rawSize(rawKey: string): Promise<number | null>;
  /** A local file path for ffmpeg and sharp. A remote implementation downloads first and cleans up in release(). */
  openRaw(rawKey: string): Promise<{ path: string; release(): Promise<void> }>;
  deleteRaw(rawKey: string): Promise<void>;
  /** Moves a finished local folder into processed storage under `prefix`. */
  putProcessed(localDir: string, prefix: string): Promise<void>;
  deleteProcessed(prefix: string): Promise<void>;
  publicUrl(key: string): string;
  /** A URL for `key` that works until `expiresAt` for every file under `scopePrefix` (an HLS manifest and its segments). */
  signedUrl(key: string, scopePrefix: string, expiresAt: Date): string;
}

/** Stand-in for S3/R2 + CDN during local development. Its HTTP side is modules/media/storage.routes.ts. */
export class LocalDiskStorage implements Storage {
  readonly rawDir: string;
  readonly processedDir: string;
  /** Scratch space for the worker, on the same disk so finished folders can be moved, not copied. */
  readonly workDir: string;

  constructor(
    rootDir: string,
    private readonly baseUrl: string,
  ) {
    this.rawDir = path.join(rootDir, 'raw');
    this.processedDir = path.join(rootDir, 'processed');
    this.workDir = path.join(rootDir, 'work');
  }

  createUploadUrl(rawKey: string, options: { contentType: string; maxBytes: number; expiresAt: Date }): string {
    const token = signToken('upload', { k: rawKey, t: options.contentType, m: options.maxBytes }, options.expiresAt);
    return `${this.baseUrl}/storage/raw/${token}`;
  }

  async rawSize(rawKey: string): Promise<number | null> {
    try {
      return (await stat(inside(this.rawDir, rawKey))).size;
    } catch {
      return null;
    }
  }

  async openRaw(rawKey: string) {
    return { path: inside(this.rawDir, rawKey), release: async () => {} };
  }

  async deleteRaw(rawKey: string): Promise<void> {
    await rm(inside(this.rawDir, rawKey), { force: true });
  }

  async putProcessed(localDir: string, prefix: string): Promise<void> {
    const target = inside(this.processedDir, prefix);
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await rename(localDir, target);
  }

  async deleteProcessed(prefix: string): Promise<void> {
    await rm(inside(this.processedDir, prefix), { recursive: true, force: true });
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/media/${key}`;
  }

  signedUrl(key: string, scopePrefix: string, expiresAt: Date): string {
    return `${this.baseUrl}/media/s/${signToken('media', { p: scopePrefix }, expiresAt)}/${key}`;
  }

  /** Writes an upload body, stopping at `maxBytes` (what a signed S3 PUT with a size condition does). */
  async writeRaw(rawKey: string, body: Readable, maxBytes: number): Promise<number> {
    const target = inside(this.rawDir, rawKey);
    await mkdir(path.dirname(target), { recursive: true });
    let bytes = 0;
    body.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) body.destroy(new HttpError(413, 'FILE_TOO_LARGE', 'File is larger than the upload allows'));
    });
    try {
      await pipeline(body, createWriteStream(target));
      if (bytes > maxBytes) throw new HttpError(413, 'FILE_TOO_LARGE', 'File is larger than the upload allows');
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
    return bytes;
  }

  /** The file for a processed key, or null if the key escapes the processed folder. */
  processedPath(key: string): string | null {
    try {
      return inside(this.processedDir, key);
    } catch {
      return null;
    }
  }
}

/** Resolves `key` inside `root`, refusing anything that escapes it. */
function inside(root: string, key: string): string {
  const target = path.resolve(root, key);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Invalid storage key: ${key}`);
  return target;
}

export const localStorage = new LocalDiskStorage(path.resolve(env.MEDIA_DIR), env.PUBLIC_URL);
export const storage: Storage = localStorage;
