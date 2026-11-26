import { File, UploadType } from 'expo-file-system';
import { api } from '@/api/client';
import type { UploadSlot } from '@/api/types';

export interface PickedFile {
  uri: string;
  mimeType: string;
  size: number;
  /** Web only: the browser File. */
  file?: Blob;
}

/** PUT the bytes to the signed URL with progress (native: expo-file-system upload task). */
export async function putFile(file: PickedFile, slot: UploadSlot['upload'], onProgress: (fraction: number) => void): Promise<void> {
  const task = new File(file.uri).createUploadTask(slot.url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: slot.headers,
    onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes ? bytesSent / totalBytes : 0),
  });
  const result = await task.uploadAsync();
  if (result.status >= 300) throw new Error(`Upload failed (HTTP ${result.status})`);
}

/**
 * The upload flow (apps/api README, "Uploading media"): ask for a slot, PUT the bytes, complete.
 * Returns the media id to attach to a post or profile.
 */
export async function uploadMedia(
  file: PickedFile,
  meta: { kind: 'image' | 'video'; purpose: 'post' | 'avatar' },
  onProgress: (fraction: number) => void,
): Promise<string> {
  const slot = await api.post<UploadSlot>('/media/uploads', { kind: meta.kind, purpose: meta.purpose, mime_type: file.mimeType, size_bytes: file.size });
  await putFile(file, slot.upload, onProgress);
  await api.post(`/media/${slot.media.id}/complete`);
  return slot.media.id;
}
