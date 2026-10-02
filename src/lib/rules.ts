// Platform content rules. Shared by the composer (live feedback) and the API (enforcement).
import type { ContentType, Issue, MediaItem, Platform, TargetOptions } from "./types";

type MediaLike = Pick<MediaItem, "id" | "mime" | "size" | "width" | "height" | "duration" | "kind">;

export interface ContentTypeInfo {
  platform: Platform;
  label: string;
  hint: string;
}

export const CONTENT_TYPES: Record<ContentType, ContentTypeInfo> = {
  ig_image: { platform: "instagram", label: "Post", hint: "Single photo in the feed" },
  ig_carousel: { platform: "instagram", label: "Carousel", hint: "2–10 photos/videos, swipeable" },
  ig_reel: { platform: "instagram", label: "Reel", hint: "Vertical video, 3 s – 15 min" },
  ig_story: { platform: "instagram", label: "Story", hint: "Photo or ≤60 s video, 24 h" },
  yt_video: { platform: "youtube", label: "Video", hint: "Standard upload" },
  yt_short: { platform: "youtube", label: "Short", hint: "Vertical/square, ≤3 min" },
  yt_live: { platform: "youtube", label: "Live", hint: "Scheduled live stream event" },
};

export const PLATFORM_TYPES: Record<Platform, ContentType[]> = {
  instagram: ["ig_image", "ig_carousel", "ig_reel", "ig_story"],
  youtube: ["yt_video", "yt_short", "yt_live"],
};

export const YT_CATEGORIES: [string, string][] = [
  ["1", "Film & Animation"],
  ["2", "Autos & Vehicles"],
  ["10", "Music"],
  ["15", "Pets & Animals"],
  ["17", "Sports"],
  ["19", "Travel & Events"],
  ["20", "Gaming"],
  ["22", "People & Blogs"],
  ["23", "Comedy"],
  ["24", "Entertainment"],
  ["25", "News & Politics"],
  ["26", "Howto & Style"],
  ["27", "Education"],
  ["28", "Science & Technology"],
  ["29", "Nonprofits & Activism"],
];

export function defaultOptions(ct: ContentType): TargetOptions {
  if (ct === "ig_reel") return { shareToFeed: true };
  if (CONTENT_TYPES[ct].platform === "youtube") {
    return {
      title: "",
      useCaption: true,
      tags: [],
      privacy: "public",
      categoryId: "22",
      madeForKids: false,
      syntheticMedia: false,
      notifySubscribers: true,
      nativeSchedule: true,
    };
  }
  return {};
}

const MB = 1024 * 1024;
const IG_VIDEO_MIMES = ["video/mp4", "video/quicktime"];

/** Picks which of the post's media items a given content type will actually publish. */
export function mediaForTarget<T extends MediaLike>(ct: ContentType, media: T[]): T[] {
  switch (ct) {
    case "ig_image":
      return media.filter((m) => m.kind === "image").slice(0, 1);
    case "ig_carousel":
      return media;
    case "ig_story":
      return media.slice(0, 1);
    case "ig_reel":
    case "yt_video":
    case "yt_short":
      return media.filter((m) => m.kind === "video").slice(0, 1);
    case "yt_live":
      return [];
  }
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
}

export function countMentions(text: string): number {
  return (text.match(/(^|\s)@[\w.]+/g) || []).length;
}

/** The caption a destination actually publishes: its own override, or the post's shared caption. */
export function captionFor(shared: string, o: TargetOptions): string {
  return o.caption ?? shared;
}

export function ytDescription(caption: string, o: TargetOptions): string {
  return o.useCaption !== false ? captionFor(caption, o) : o.description || "";
}

function ratio(m: MediaLike): number | null {
  return m.width && m.height ? m.width / m.height : null;
}

function fmtSec(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
}

function igImageIssues(m: MediaLike, out: Issue[], label: string, checkRatio = true) {
  if (m.mime !== "image/jpeg") out.push({ level: "error", message: `${label}: Instagram only accepts JPEG images.` });
  if (m.size > 8 * MB) out.push({ level: "error", message: `${label}: image exceeds Instagram's 8 MB limit.` });
  const r = ratio(m);
  if (checkRatio && r !== null && (r < 0.8 - 0.005 || r > 1.91 + 0.005)) {
    out.push({
      level: "error",
      message: `${label}: aspect ratio ${r.toFixed(2)} is outside Instagram's 4:5 – 1.91:1 range for feed photos.`,
    });
  }
}

function igVideoIssues(m: MediaLike, out: Issue[], label: string, minS: number, maxS: number, maxMB: number) {
  if (!IG_VIDEO_MIMES.includes(m.mime)) out.push({ level: "error", message: `${label}: Instagram needs MP4 or MOV video.` });
  if (m.size > maxMB * MB) out.push({ level: "error", message: `${label}: video exceeds ${maxMB} MB.` });
  if (m.duration != null && (m.duration < minS || m.duration > maxS)) {
    out.push({ level: "error", message: `${label}: duration ${fmtSec(m.duration)} must be between ${fmtSec(minS)} and ${fmtSec(maxS)}.` });
  }
}

function ytTextIssues(text: string, field: string, maxBytes: number, out: Issue[]) {
  if (/[<>]/.test(text)) out.push({ level: "error", message: `YouTube ${field} cannot contain < or >.` });
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxBytes) out.push({ level: "error", message: `YouTube ${field} is ${bytes} bytes; limit is ${maxBytes}.` });
}

export function tagsLength(tags: string[]): number {
  // YouTube counts the comma separators and wraps tags containing spaces in quotes.
  return tags.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

export interface ValidateInput {
  contentType: ContentType;
  options: TargetOptions;
  caption: string;
  media: MediaLike[];
  /** Media referenced by options (thumbnails, covers), by id. */
  lookup: (id: string) => MediaLike | undefined;
  scheduledAt: number | null;
  mode: "draft" | "schedule" | "now";
  now?: number;
}

export const SCHEDULE_ERRORS = ["Pick a date and time.", "Scheduled time is in the past."];

/** Media-only errors for a content type: does what's attached fit it at all? */
export function mediaProblems(ct: ContentType, media: MediaLike[]): string[] {
  return validateTarget({ contentType: ct, options: { title: "x" }, caption: "", media, lookup: () => undefined, scheduledAt: null, mode: "draft" })
    .filter((i) => i.level === "error")
    .map((i) => i.message);
}

export function validateTarget(input: ValidateInput): Issue[] {
  const { contentType: ct, options: o, media, lookup, mode } = input;
  const caption = captionFor(input.caption, o);
  const now = input.now ?? Date.now();
  const out: Issue[] = [];
  const used = mediaForTarget(ct, media);
  const platform = CONTENT_TYPES[ct].platform;

  if (mode === "schedule") {
    if (input.scheduledAt == null) out.push({ level: "error", message: SCHEDULE_ERRORS[0] });
    else if (input.scheduledAt < now - 60_000) out.push({ level: "error", message: SCHEDULE_ERRORS[1] });
  }

  if (platform === "instagram") {
    if (ct === "ig_story") {
      if (caption.trim()) out.push({ level: "warning", message: "Stories have no caption; it will be ignored." });
    } else {
      if (caption.length > 2200) out.push({ level: "error", message: `Caption is ${caption.length} characters; Instagram allows 2,200.` });
      if (countHashtags(caption) > 30) out.push({ level: "error", message: "Instagram allows at most 30 hashtags." });
      if (countMentions(caption) > 20) out.push({ level: "error", message: "Instagram allows at most 20 @mentions." });
    }
    if ((o.firstComment || "").length > 2200) out.push({ level: "error", message: "First comment exceeds 2,200 characters." });
  }

  switch (ct) {
    case "ig_image": {
      if (!used.length) out.push({ level: "error", message: "Add a photo." });
      else igImageIssues(used[0], out, "Photo");
      if (media.length > 1) out.push({ level: "warning", message: "Only the first photo is posted. Use Carousel for multiple items." });
      break;
    }
    case "ig_carousel": {
      if (media.length < 2) out.push({ level: "error", message: "A carousel needs at least 2 items." });
      if (media.length > 10) out.push({ level: "error", message: "A carousel allows at most 10 items." });
      media.forEach((m, i) => {
        if (m.kind === "image") igImageIssues(m, out, `Item ${i + 1}`);
        else igVideoIssues(m, out, `Item ${i + 1}`, 3, 60, 100);
      });
      const ratios = media.map(ratio).filter((r): r is number => r !== null);
      if (ratios.some((r) => Math.abs(r - ratios[0]) > 0.02)) {
        out.push({ level: "warning", message: "Items have different aspect ratios; Instagram crops all to the first item's." });
      }
      break;
    }
    case "ig_reel": {
      if (!used.length) out.push({ level: "error", message: "Add a video." });
      else {
        igVideoIssues(used[0], out, "Reel", 3, 15 * 60, 300);
        const r = ratio(used[0]);
        if (r !== null && Math.abs(r - 9 / 16) > 0.02) out.push({ level: "warning", message: "Reels look best at 9:16; this video will be letterboxed or cropped." });
      }
      if (o.coverMediaId) {
        const c = lookup(o.coverMediaId);
        if (!c) out.push({ level: "error", message: "Cover image no longer exists (deleted after publishing?). Choose another." });
        else igImageIssues(c, out, "Cover", false);
      }
      break;
    }
    case "ig_story": {
      if (!used.length) out.push({ level: "error", message: "Add a photo or video." });
      else if (used[0].kind === "image") igImageIssues(used[0], out, "Story", false);
      else igVideoIssues(used[0], out, "Story", 3, 60, 100);
      if (media.length > 1) out.push({ level: "warning", message: "Only the first item becomes the story. Schedule separate posts for more frames." });
      break;
    }
    case "yt_video":
    case "yt_short":
    case "yt_live": {
      const title = (o.title || "").trim();
      if (!title) out.push({ level: "error", message: "YouTube needs a title." });
      if (title.length > 100) out.push({ level: "error", message: `Title is ${title.length} characters; YouTube allows 100.` });
      ytTextIssues(title, "title", 400, out);
      ytTextIssues(ytDescription(caption, o), "description", 5000, out);
      if (o.tags && tagsLength(o.tags) > 500) out.push({ level: "error", message: "Tags exceed YouTube's 500-character total." });
      if (o.thumbnailMediaId) {
        const t = lookup(o.thumbnailMediaId);
        if (!t) out.push({ level: "error", message: "Thumbnail no longer exists (deleted after publishing?). Choose another." });
        else {
          if (!["image/jpeg", "image/png"].includes(t.mime)) out.push({ level: "error", message: "Thumbnail must be JPEG or PNG." });
          if (t.size > 2 * MB) out.push({ level: "error", message: "Thumbnail exceeds YouTube's 2 MB limit." });
        }
      }
      if (ct === "yt_live") {
        if (mode === "now") out.push({ level: "error", message: "Live events need a scheduled start time." });
        if (media.length) out.push({ level: "warning", message: "Live events don't upload media; attached files are ignored (use a thumbnail instead)." });
        break;
      }
      if (!used.length) {
        out.push({ level: "error", message: "Add a video." });
        break;
      }
      const v = used[0];
      if (ct === "yt_short") {
        if (v.duration != null && v.duration > 180) out.push({ level: "error", message: "Shorts must be 3 minutes or less." });
        if (v.width && v.height && v.width > v.height) out.push({ level: "error", message: "Shorts must be vertical or square." });
      }
      if (media.filter((m) => m.kind === "video").length > 1) out.push({ level: "warning", message: "YouTube uploads only the first video." });
      break;
    }
  }
  return out;
}

/**
 * When the worker should pick a target up. YouTube can schedule natively (upload now as private
 * with publishAt), which removes the dependency on this server being up at publish time.
 */
export function computeDispatchAt(ct: ContentType, o: TargetOptions, scheduledAt: number, now = Date.now()): number {
  if (ct === "yt_live") return now;
  if ((ct === "yt_video" || ct === "yt_short") && usesNativeSchedule(o, scheduledAt, now)) return now;
  return scheduledAt;
}

export function usesNativeSchedule(o: TargetOptions, scheduledAt: number, now = Date.now()): boolean {
  return o.nativeSchedule !== false && (o.privacy ?? "public") === "public" && scheduledAt > now + 10 * 60_000;
}
