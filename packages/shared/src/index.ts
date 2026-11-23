// Values shared by the API and the apps. Enum lists mirror the CHECK constraints
// in the database migrations; change both together.

export const REEL_MAX_SECONDS = 90;
export const LEARN_VIDEO_MAX_SECONDS = 20 * 60;

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Autocomplete: wait this long after the last keystroke and need this many characters. */
export const SEARCH_SUGGEST_DEBOUNCE_MS = 250;
export const SEARCH_SUGGEST_MIN_CHARS = 2;

export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
/** 'inactive': unfollowed, withdrawn or declined. The row stays so a re-follow doesn't notify again; the API reports it as 'none'. */
export const FOLLOW_STATUSES = ['accepted', 'pending', 'inactive'] as const;
export const PLATFORMS = ['android', 'ios', 'web'] as const;

export const POST_TYPES = ['text', 'image', 'reel'] as const;
export const POST_STATUSES = ['processing', 'published', 'removed'] as const;
export const NOTIFICATION_TYPES = ['follow', 'follow_request', 'like', 'comment', 'reply', 'post_ready'] as const;

export const MEDIA_KINDS = ['image', 'video'] as const;
export const MEDIA_PURPOSES = ['post', 'avatar', 'learn', 'paper_figure'] as const;
export const MEDIA_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;

export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;
export const LEARN_ITEM_KINDS = ['video', 'image', 'text'] as const;
export const QUESTION_KINDS = ['mcq', 'short'] as const;
export const PAPER_STATUSES = ['saved', 'reading', 'completed'] as const;

// Research tab (migration 005)
/** Languages a Paper Card, a trail or other content can be written in. */
export const CONTENT_LANGS = ['en', 'bn'] as const;
/** Reading tracker steps: 0 = not read yet. */
export const READING_STEPS = [0, 1, 2, 3] as const;
export const READING_STEP_LABELS = {
  1: { en: 'Explored', bn: 'দেখা হয়েছে' },
  2: { en: 'Studied', bn: 'পড়া হয়েছে' },
  3: { en: 'Reproduced', bn: 'রিপ্রোডিউস' },
} as const;
export const PAPER_NOTE_MAX_LENGTH = 400;
/** A paper shows the "New" badge for this many days after its publication date. */
export const PAPER_NEW_DAYS = 30;
/** A paper counts as trending while it was on Hugging Face daily papers within this many days. */
export const PAPER_TRENDING_DAYS = 14;
export const PAPER_CARD_SOURCES = ['staff', 'ai'] as const;
export const PAPER_EDGE_INTENTS = ['background', 'supporting', 'contrasting'] as const;
export const PAPER_EDGE_SOURCES = ['semantic_scholar', 'openalex', 'staff'] as const;
export const RESEARCH_OUTPUT_KINDS = ['reading_map', 'landscape_map', 'roadmap', 'comparison', 'claim_check'] as const;
export const TRAIL_STATUSES = ['draft', 'published', 'removed'] as const;
export const TRAIL_MAX_ITEMS = 30;
export const PREREQUISITE_SOURCES = ['staff', 'ai'] as const;
/** What a Learn before reading row links to: lesson and note are learn items (video, or text and image). */
export const PREREQUISITE_LINK_KINDS = ['lesson', 'note', 'quiz', 'reel'] as const;

export const REPORT_TARGET_TYPES = ['user', 'post', 'comment', 'trail'] as const;
export const REPORT_REASONS = ['spam', 'harassment', 'nudity', 'violence', 'misinformation', 'other'] as const;
export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type FollowStatus = (typeof FOLLOW_STATUSES)[number];
export type Platform = (typeof PLATFORMS)[number];
export type PostType = (typeof POST_TYPES)[number];
export type PostStatus = (typeof POST_STATUSES)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type MediaKind = (typeof MEDIA_KINDS)[number];
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
export type MediaStatus = (typeof MEDIA_STATUSES)[number];
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type LearnItemKind = (typeof LEARN_ITEM_KINDS)[number];
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export type PaperStatus = (typeof PAPER_STATUSES)[number];
export type ContentLang = (typeof CONTENT_LANGS)[number];
export type ReadingStep = (typeof READING_STEPS)[number];
export type PaperCardSource = (typeof PAPER_CARD_SOURCES)[number];
export type PaperEdgeIntent = (typeof PAPER_EDGE_INTENTS)[number];
export type PaperEdgeSource = (typeof PAPER_EDGE_SOURCES)[number];
export type ResearchOutputKind = (typeof RESEARCH_OUTPUT_KINDS)[number];
export type TrailStatus = (typeof TRAIL_STATUSES)[number];
export type PrerequisiteSource = (typeof PREREQUISITE_SOURCES)[number];
export type PrerequisiteLinkKind = (typeof PREREQUISITE_LINK_KINDS)[number];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
