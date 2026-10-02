// Types shared between server and client.

export type Platform = "instagram" | "youtube";

export type ContentType =
  | "ig_image"
  | "ig_carousel"
  | "ig_reel"
  | "ig_story"
  | "yt_video"
  | "yt_short"
  | "yt_live";

export type TargetStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "platform_scheduled"
  | "failed";

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed";

export interface MediaItem {
  id: string;
  url: string;
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  kind: "image" | "video";
  createdAt: number;
}

export type YtPrivacy = "public" | "unlisted" | "private";

export interface TargetOptions {
  // Instagram
  firstComment?: string;
  shareToFeed?: boolean;
  coverMediaId?: string;
  thumbOffsetSec?: number;
  // YouTube
  title?: string;
  description?: string;
  useCaption?: boolean;
  tags?: string[];
  privacy?: YtPrivacy;
  categoryId?: string;
  madeForKids?: boolean;
  syntheticMedia?: boolean;
  playlistId?: string;
  thumbnailMediaId?: string;
  notifySubscribers?: boolean;
  nativeSchedule?: boolean;
}

export interface AccountSummary {
  id: string;
  platform: Platform;
  mode: "live" | "demo";
  name: string;
  username: string | null;
  avatarUrl: string | null;
  status: "ok" | "reconnect";
  statusMessage: string | null;
  tokenExpiresAt: number | null;
  createdAt: number;
}

export interface TargetEvent {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface PostTarget {
  id: string;
  accountId: string;
  account: AccountSummary | null;
  contentType: ContentType;
  options: TargetOptions;
  status: TargetStatus;
  dispatchAt: number | null;
  attempts: number;
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  publishedAt: number | null;
  events?: TargetEvent[];
}

export interface Post {
  id: string;
  caption: string;
  scheduledAt: number | null;
  status: PostStatus;
  editable: boolean;
  media: MediaItem[];
  targets: PostTarget[];
  createdAt: number;
  updatedAt: number;
}

export interface TargetInput {
  accountId: string;
  contentType: ContentType;
  options: TargetOptions;
}

export interface PostInput {
  caption: string;
  mediaIds: string[];
  mode: "draft" | "schedule" | "now";
  scheduledAt: number | null;
  targets: TargetInput[];
}

export interface Issue {
  level: "error" | "warning";
  message: string;
}
