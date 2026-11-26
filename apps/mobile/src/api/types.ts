import type {
  ContentLang,
  LearnItemKind,
  MediaKind,
  MediaStatus,
  NotificationType,
  PaperEdgeIntent,
  PostStatus,
  PostType,
  PrerequisiteLinkKind,
  QuestionKind,
  ReadingStep,
  ReportReason,
  ReportTargetType,
  TrailStatus,
} from '@doshomik/shared';

// Response shapes of the API (apps/api), as the app reads them. Dates are ISO strings.

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface Ref {
  slug: string;
  name: string;
}

export interface UserSummary {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface Account extends UserSummary {
  email: string;
  bio: string | null;
  role: 'user' | 'moderator' | 'admin';
  is_private: boolean;
  created_at: string;
  email_verified: boolean;
  two_factor_enabled: boolean;
}

export interface Profile extends UserSummary {
  bio: string | null;
  is_private: boolean;
  created_at: string;
  is_me: boolean;
  posts_count: number;
  followers_count: number;
  following_count: number;
  follow_status: 'none' | 'pending' | 'accepted';
}

export interface Suggestion extends UserSummary {
  is_private: boolean;
  followers_count: number;
}

export interface MediaView {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  url: string | null;
  thumbnail_url: string | null;
  full_url: string | null;
}

export interface Post {
  id: string;
  type: PostType;
  caption: string | null;
  topic: Ref | null;
  status: PostStatus;
  media: MediaView | null;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
  created_at: string;
  author: UserSummary;
  share_url: string;
}

export interface Comment {
  id: string;
  post_id: string | null;
  paper_id: string | null;
  parent_id: string | null;
  body: string | null;
  author: UserSummary | null;
  is_deleted: boolean;
  created_at: string;
  reply_count: number;
}

export interface Notification {
  id: string;
  type: NotificationType;
  post_id: string | null;
  comment_id: string | null;
  paper_id: string | null;
  is_read: boolean;
  created_at: string;
  actor: UserSummary;
}

export interface FollowRequest extends UserSummary {
  requested_at: string;
}

// ---------- Research ----------

export interface Field {
  slug: string;
  name: string;
  description: string | null;
  position: number;
}

/** A paper as lists show it. */
export interface PaperCard {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  venue: string | null;
  created_at: string;
  field: Ref;
  share_url: string;
  question: { en: string | null; bn: string | null };
  tldr: string | null;
  citation_count: number | null;
  hf_upvotes: number | null;
  trend_rank: number | null;
  is_trending: boolean;
  is_new: boolean;
  saved_by_me: boolean;
  my_step: ReadingStep;
}

export interface Figure {
  url: string;
  caption?: string | null;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

/** One language's Paper Card: the structured explanation. */
export interface CardContent {
  question: string | null;
  extra_questions: string[];
  problem: string | null;
  key_idea: string | null;
  data_source: string | null;
  method_steps: string[];
  findings: string | null;
  evaluation: string | null;
  figures: Figure[];
  takeaway: string | null;
  limitations: string | null;
  glossary: GlossaryEntry[];
  source: 'staff' | 'ai';
  updated_at: string;
}

export interface ReadingPass {
  step: ReadingStep;
  note: string | null;
  explored_at: string | null;
  studied_at: string | null;
  reproduced_at: string | null;
  updated_at: string;
}

export interface PaperDetail extends PaperCard {
  paper_url: string;
  abstract: string | null;
  doi: string | null;
  arxiv_id: string | null;
  published_on: string | null;
  links: { open_url: string; pdf_url: string | null; code_url: string | null };
  cards: Partial<Record<ContentLang, CardContent>>;
  my_reading: ReadingPass | null;
}

export interface PrerequisiteLink {
  kind: PrerequisiteLinkKind;
  id: string;
  title: string | null;
  minutes?: number | null;
  question_count?: number;
  seconds?: number | null;
}

export interface Prerequisite {
  slug: string;
  name: string;
  summary: string | null;
  label: string;
  why: string | null;
  suggested_by: 'staff' | 'ai';
  link: PrerequisiteLink | null;
  known: boolean;
  done: boolean;
}

export interface LearnFirst {
  total: number;
  ready: number;
  ai_suggested: boolean;
  topic_count: number;
  topics_with_learn_items: number;
  topics: Prerequisite[];
}

export interface LineagePaper extends PaperCard {
  intent: PaperEdgeIntent | null;
  is_influential: boolean;
}

export interface Lineage {
  builds_on: LineagePaper[];
  built_on_by: LineagePaper[];
}

export interface Step {
  step: number;
  note: string | null;
  paper: PaperCard;
}

export interface Roadmap {
  field: { slug: string; name: string; description: string | null };
  steps: Step[];
}

export interface Trail {
  id: string;
  title: string;
  description: string | null;
  lang: ContentLang;
  status: TrailStatus;
  field: Ref | null;
  creator: UserSummary;
  paper_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrailDetail extends Trail {
  steps: Step[];
}

export interface ReadingCounts {
  explored: number;
  studied: number;
  reproduced: number;
}

export interface ReadingStats {
  this_month: ReadingCounts;
  total: ReadingCounts;
}

export interface UserReadingStats {
  visible: boolean;
  this_month: ReadingCounts | null;
  total: ReadingCounts | null;
}

// ---------- Learn and practice ----------

export interface Topic {
  slug: string;
  name: string;
  summary: string | null;
  field: Ref | null;
}

export interface LearnItem {
  id: string;
  topic: Ref | null;
  title: string;
  kind: LearnItemKind;
  body: string | null;
  media: MediaView | null;
  media_url: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface TopicDetail extends Topic {
  learn_items: LearnItem[];
}

export interface Course {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  external_url: string | null;
  field: Ref | null;
  created_at: string;
  share_url: string;
  item_count: number;
  my_progress: { last_position: number; completed_at: string | null } | null;
}

export interface CourseDetail extends Course {
  items: (LearnItem & { step: number })[];
}

export interface Question {
  id: string;
  topic: Ref | null;
  kind: QuestionKind;
  prompt: string;
  options: string[] | null;
}

export interface AnswerResult {
  correct: boolean;
  correct_answer: string;
  explanation: string | null;
}

export interface PracticeStats {
  attempts: number;
  correct: number;
  accuracy: number | null;
  streak_days: number;
  topics: { slug: string; name: string; attempts: number; correct: number; accuracy: number }[];
}

export interface HistoryEntry {
  question_id: string;
  prompt: string;
  topic: Ref | null;
  answer: string;
  is_correct: boolean;
  created_at: string;
}

export interface Quiz {
  id: string;
  title: string;
  topic: Ref | null;
  created_at: string;
  question_count: number;
}

export interface QuizDetail extends Quiz {
  questions: Question[];
}

// ---------- Search ----------

export interface SearchResults {
  users?: (UserSummary & { is_private: boolean })[];
  posts?: Post[];
  topics?: { slug: string; name: string; summary: string | null }[];
  learn_items?: { id: string; topic: Ref | null; title: string; kind: LearnItemKind }[];
  courses?: { id: string; title: string; description: string | null; thumbnail_url: string | null; external_url: string | null }[];
  papers?: PaperCard[];
}

export type SearchType = keyof SearchResults;

export interface Suggestion2 {
  type: 'topic' | 'paper' | 'course' | 'user';
  id: string;
  label: string;
}

export interface UploadSlot {
  media: { id: string; status: MediaStatus };
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expires_at: string };
}

export interface ReportInput {
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details?: string;
}
