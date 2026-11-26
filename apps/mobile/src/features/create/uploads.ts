import { create } from 'zustand';
import { api } from '@/api/client';
import { keys, queryClient } from '@/api/query';
import type { MediaView } from '@/api/types';
import { translate } from '@/i18n';
import { uploadMedia, type PickedFile } from '@/lib/upload';

export interface UploadJob {
  /** Identifies this job, so a dismissed job's late updates never touch a newer one. */
  id: number;
  kind: 'image' | 'reel';
  file: PickedFile;
  caption: string | null;
  topic: string | null;
  preview: string;
  progress: number;
  status: 'uploading' | 'processing' | 'live' | 'failed';
  error?: string;
  /** Set once the file is uploaded and completed: a retry doesn't upload it again. */
  mediaId?: string;
  /** Set once the post exists: a retry only waits for processing, it never posts twice. */
  posted?: boolean;
  postId?: string;
  /** Processing itself failed on the server: a retry must upload a fresh file. */
  mediaFailed?: boolean;
}

interface UploadStore {
  job: UploadJob | null;
  start: (job: Pick<UploadJob, 'kind' | 'file' | 'caption' | 'topic' | 'preview'>) => void;
  retry: () => void;
  dismiss: () => void;
}

const POLL_MS = 3000;
const POLL_LIMIT = 100; // about five minutes
let nextId = 1;

/**
 * The one post being uploaded. The create screen closes at once and the upload carries on here,
 * shown as a banner above the tab bar, so the user can keep browsing while a reel is processed.
 */
export const useUploads = create<UploadStore>((set, get) => ({
  job: null,
  start: (job) => {
    const id = nextId++;
    set({ job: { ...job, id, progress: 0, status: 'uploading' } });
    void run(id);
  },
  retry: () => {
    const job = get().job;
    if (!job) return;
    // A media file the server rejected (e.g. a reel over 90 s) is uploaded again as a new post;
    // otherwise the retry resumes after the last step that succeeded.
    if (job.mediaFailed && job.postId) void api.delete(`/posts/${job.postId}`).catch(() => undefined); // the stuck post
    const fresh = job.mediaFailed ? { mediaId: undefined, posted: false, postId: undefined, mediaFailed: false } : {};
    set({ job: { ...job, ...fresh, status: job.posted && !job.mediaFailed ? 'processing' : 'uploading', error: undefined } });
    void run(job.id);
  },
  dismiss: () => set({ job: null }),
}));

/** Updates the job only while it is still the current one. Returns false once it isn't. */
const update = (id: number, changes: Partial<UploadJob>): boolean => {
  const job = useUploads.getState().job;
  if (!job || job.id !== id) return false;
  useUploads.setState({ job: { ...job, ...changes } });
  return true;
};

const current = (id: number) => {
  const job = useUploads.getState().job;
  return job && job.id === id ? job : null;
};

async function run(id: number) {
  const job = current(id);
  if (!job) return;
  try {
    let mediaId = job.mediaId;
    if (!mediaId) {
      mediaId = await uploadMedia(job.file, { kind: job.kind === 'reel' ? 'video' : 'image', purpose: 'post' }, (progress) => void update(id, { progress }));
      if (!update(id, { mediaId, status: 'processing', progress: 1 })) return;
    }
    if (!current(id)?.posted) {
      const post = await api.post<{ id: string }>('/posts', { type: job.kind, media_id: mediaId, caption: job.caption, topic: job.topic ?? undefined });
      if (!update(id, { posted: true, postId: post.id })) return;
    }
    // The worker publishes the post when the media is ready (a reel over 90 s fails here).
    for (let i = 0; i < POLL_LIMIT; i++) {
      if (!current(id)) return;
      const media = await api.get<MediaView & { error: string | null }>(`/media/${mediaId}`);
      if (media.status === 'ready') {
        if (!update(id, { status: 'live' })) return;
        for (const key of [keys.feed, keys.reels, ['explore'], ['user']]) void queryClient.invalidateQueries({ queryKey: key });
        setTimeout(() => current(id)?.status === 'live' && useUploads.getState().dismiss(), 4000);
        return;
      }
      if (media.status === 'failed') {
        update(id, { status: 'failed', mediaFailed: true, error: media.error ?? translate('create.failed') });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    // Still processing after five minutes: stop waiting; Retry resumes the wait.
    update(id, { status: 'failed', error: translate('create.processing') });
  } catch (error) {
    update(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}
