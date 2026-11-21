// Values shared by the API and the apps. Enum lists mirror the CHECK constraints
// in the Prototype v1 schema; change both together.

export const REEL_MAX_SECONDS = 90;

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const USER_ROLES = ['user', 'admin'] as const;
export const POST_TYPES = ['text', 'image', 'reel'] as const;
export const LEARN_ITEM_KINDS = ['video', 'image', 'text'] as const;
export const QUESTION_KINDS = ['mcq', 'short'] as const;
export const NOTIFICATION_TYPES = ['follow', 'like', 'comment', 'reply'] as const;
export const PAPER_STATUSES = ['saved', 'reading', 'completed'] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type PostType = (typeof POST_TYPES)[number];
export type LearnItemKind = (typeof LEARN_ITEM_KINDS)[number];
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type PaperStatus = (typeof PAPER_STATUSES)[number];
