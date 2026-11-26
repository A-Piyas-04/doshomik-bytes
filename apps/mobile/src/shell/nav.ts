import { router } from 'expo-router';

/**
 * Navigation in one place. Shared screens exist in every tab's stack, so pushing one keeps the
 * user in the tab they are in (Instagram-style per-tab history).
 */
export const go = {
  paper: (id: string) => router.push({ pathname: '/paper/[id]', params: { id } }),
  learnFirst: (id: string) => router.push({ pathname: '/paper/[id]/learn-first', params: { id } }),
  roadmaps: (field?: string) => router.push({ pathname: '/roadmaps', params: field ? { field } : {} }),
  trails: () => router.push('/trails'),
  trail: (id: string) => router.push({ pathname: '/trail/[id]', params: { id } }),
  newTrail: (paper?: string) => router.push({ pathname: '/trail-editor', params: paper ? { paper } : {} }),
  editTrail: (id: string) => router.push({ pathname: '/trail-editor', params: { id } }),
  library: () => router.push('/library'),
  paperSearch: () => router.push('/paper-search'),
  course: (id: string) => router.push({ pathname: '/course/[id]', params: { id } }),
  lesson: (id: string, course?: { id: string; step: number }) =>
    router.push({ pathname: '/lesson/[id]', params: course ? { id, course: course.id, step: String(course.step) } : { id } }),
  /** Inside a course: swap the lesson in place, so Back returns to the course. */
  courseStep: (id: string, course: { id: string; step: number }) =>
    router.replace({ pathname: '/lesson/[id]', params: { id, course: course.id, step: String(course.step) } }),
  topic: (slug: string) => router.push({ pathname: '/topic/[slug]', params: { slug } }),
  practice: () => router.push('/practice'),
  practiceSession: (params: { field?: string; topic?: string; quiz?: string }) =>
    router.push({ pathname: '/practice/session', params: Object.fromEntries(Object.entries(params).filter(([, v]) => !!v)) as Record<string, string> }),
  practiceHistory: () => router.push('/practice/history'),
  post: (id: string) => router.push({ pathname: '/post/[id]', params: { id } }),
  comments: (kind: 'posts' | 'papers', id: string, focus?: boolean) =>
    router.push({ pathname: '/comments/[kind]/[id]', params: focus ? { kind, id, focus: '1' } : { kind, id } }),
  user: (id: string) => router.push({ pathname: '/user/[id]', params: { id } }),
  notifications: () => router.push('/notifications'),
  settings: () => router.push('/settings'),
  savedPosts: () => router.push('/settings/saved'),
  blocked: () => router.push('/settings/blocked'),
  editProfile: () => router.push('/edit-profile'),
  reel: (id: string) => router.push({ pathname: '/reel/[id]', params: { id } }),
  image: (url: string) => router.push({ pathname: '/viewer', params: { url } }),
  create: (kind: 'text' | 'image' | 'reel') => router.push(`/create/${kind}`),
  explore: () => router.navigate('/explore'),
};
