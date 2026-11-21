import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

/**
 * Where uploaded media lives. The database only stores the returned URL, so the
 * local disk can later be swapped for the VPS or S3/R2 behind this interface.
 */
export interface Storage {
  /** Moves a validated temp file to `key` and returns its public URL. */
  save(tempPath: string, key: string): Promise<string>;
  /** Deletes a file by the URL `save` returned. URLs it does not own are ignored. */
  remove(url: string): Promise<void>;
}

class LocalDiskStorage implements Storage {
  constructor(
    private readonly rootDir: string,
    private readonly baseUrl: string,
  ) {}

  async save(tempPath: string, key: string): Promise<string> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(tempPath, target);
    return `${this.baseUrl}/${key}`;
  }

  async remove(url: string): Promise<void> {
    const prefix = `${this.baseUrl}/`;
    if (!url.startsWith(prefix)) return;
    const target = this.resolve(url.slice(prefix.length));
    await rm(target, { force: true });
  }

  /** Resolves a key inside the root directory, refusing anything that escapes it. */
  private resolve(key: string): string {
    const target = path.resolve(this.rootDir, key);
    if (!target.startsWith(this.rootDir + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return target;
  }
}

export const mediaRoot = path.resolve(env.MEDIA_DIR);

/** Unvalidated uploads wait here; this folder is never served. */
export const uploadTempDir = path.join(mediaRoot, 'tmp');

export const storage: Storage = new LocalDiskStorage(mediaRoot, env.MEDIA_BASE_URL);
