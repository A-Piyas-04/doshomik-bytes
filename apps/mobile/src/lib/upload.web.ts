import { api } from '@/api/client';
import type { UploadSlot } from '@/api/types';

export interface PickedFile {
  uri: string;
  mimeType: string;
  size: number;
  /** Web only: the browser File. */
  file?: Blob;
}

/** Web: XMLHttpRequest, for upload progress (expo-file-system has no web support). */
export async function putFile(file: PickedFile, slot: UploadSlot['upload'], onProgress: (fraction: number) => void): Promise<void> {
  const body = file.file ?? (await (await fetch(file.uri)).blob());
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', slot.url);
    for (const [name, value] of Object.entries(slot.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(body);
  });
}

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
