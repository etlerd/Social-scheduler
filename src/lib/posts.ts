import { db } from "./db";
import { randomId } from "./crypto";
import { ApiError } from "./errors";
import { getAccountRow, toAccountSummary, type AccountRow } from "./accounts";
import { getMediaRows, toMediaItem, type MediaRow } from "./media";
import { CONTENT_TYPES, computeDispatchAt, validateTarget } from "./rules";
import type { Issue, Post, PostInput, PostStatus, PostTarget, TargetEvent, TargetOptions, TargetStatus } from "./types";

export interface PostRow {
  id: string;
  caption: string;
  scheduled_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TargetRow {
  id: string;
  post_id: string;
  account_id: string;
  content_type: PostTarget["contentType"];
  options: string;
  status: TargetStatus;
  dispatch_at: number | null;
  attempts: number;
  container_id: string | null;
  external_id: string | null;
  external_url: string | null;
  error: string | null;
  published_at: number | null;
  updated_at: number;
}

const LOCKED: TargetStatus[] = ["publishing", "published", "platform_scheduled"];

export function aggregateStatus(statuses: TargetStatus[]): PostStatus {
  if (!statuses.length || statuses.every((s) => s === "draft")) return "draft";
  if (statuses.includes("publishing")) return "publishing";
  const done = statuses.filter((s) => s === "published" || s === "platform_scheduled").length;
  if (statuses.includes("failed")) return done ? "partial" : "failed";
  if (statuses.includes("scheduled") || statuses.includes("draft")) return "scheduled";
  return "published";
}

function hydrate(posts: PostRow[], withEvents = false): Post[] {
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id);
  const ph = ids.map(() => "?").join(",");
  const targets = db().prepare(`SELECT * FROM post_targets WHERE post_id IN (${ph}) ORDER BY rowid`).all(...ids) as TargetRow[];
  const pm = db()
    .prepare(`SELECT pm.post_id, m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id IN (${ph}) ORDER BY pm.position`)
    .all(...ids) as (MediaRow & { post_id: string })[];
  const accountIds = [...new Set(targets.map((t) => t.account_id))];
  const accounts = new Map<string, AccountRow>();
  for (const id of accountIds) {
    const a = getAccountRow(id);
    if (a) accounts.set(id, a);
  }
  const events = new Map<string, TargetEvent[]>();
  if (withEvents && targets.length) {
    const rows = db()
      .prepare(`SELECT target_id, at, level, message FROM target_events WHERE target_id IN (${targets.map(() => "?").join(",")}) ORDER BY id`)
      .all(...targets.map((t) => t.id)) as (TargetEvent & { target_id: string })[];
    for (const { target_id, ...e } of rows) {
      if (!events.has(target_id)) events.set(target_id, []);
      events.get(target_id)!.push(e);
    }
  }
  return posts.map((p) => {
    const ts: PostTarget[] = targets
      .filter((t) => t.post_id === p.id)
      .map((t) => {
        const a = accounts.get(t.account_id);
        return {
          id: t.id,
          accountId: t.account_id,
          account: a ? toAccountSummary(a) : null,
          contentType: t.content_type,
          options: JSON.parse(t.options) as TargetOptions,
          status: t.status,
          dispatchAt: t.dispatch_at,
          attempts: t.attempts,
          externalId: t.external_id,
          externalUrl: t.external_url,
          error: t.error,
          publishedAt: t.published_at,
          ...(withEvents ? { events: events.get(t.id) ?? [] } : {}),
        };
      });
    return {
      id: p.id,
      caption: p.caption,
      scheduledAt: p.scheduled_at,
      status: aggregateStatus(ts.map((t) => t.status)),
      editable: !ts.some((t) => LOCKED.includes(t.status)),
      media: pm.filter((m) => m.post_id === p.id).map(toMediaItem),
      targets: ts,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });
}

export function listPosts(q: { from?: number; to?: number } = {}): Post[] {
  let rows: PostRow[];
  if (q.from != null && q.to != null) {
    rows = db()
      .prepare("SELECT * FROM posts WHERE scheduled_at >= ? AND scheduled_at < ? ORDER BY scheduled_at")
      .all(q.from, q.to) as PostRow[];
  } else {
    rows = db()
      .prepare("SELECT * FROM posts ORDER BY COALESCE(scheduled_at, updated_at) DESC LIMIT 500")
      .all() as PostRow[];
  }
  return hydrate(rows);
}

export function getPost(id: string, withEvents = false): Post | undefined {
  const row = db().prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined;
  return row ? hydrate([row], withEvents)[0] : undefined;
}

export function getPostRow(id: string): PostRow | undefined {
  return db().prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined;
}

export function getTargetRow(id: string): TargetRow | undefined {
  return db().prepare("SELECT * FROM post_targets WHERE id = ?").get(id) as TargetRow | undefined;
}

export function postMediaRows(postId: string): MediaRow[] {
  return db()
    .prepare("SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = ? ORDER BY pm.position")
    .all(postId) as MediaRow[];
}

export function addEvent(targetId: string, level: TargetEvent["level"], message: string) {
  db().prepare("INSERT INTO target_events (target_id, at, level, message) VALUES (?, ?, ?, ?)").run(targetId, Date.now(), level, message);
}

function sanitizeOptions(o: TargetOptions): TargetOptions {
  const out: TargetOptions = { ...o };
  if (out.tags) out.tags = out.tags.map((t) => String(t).trim()).filter(Boolean);
  if (out.thumbOffsetSec != null) out.thumbOffsetSec = Math.max(0, Number(out.thumbOffsetSec) || 0);
  return out;
}

/** Validates and writes a post. Returns the post, or throws ApiError(422) with per-target issues. */
export function savePost(input: PostInput, existingId?: string, now = Date.now()): Post {
  if (!Array.isArray(input.targets) || !Array.isArray(input.mediaIds)) throw new ApiError(400, "Malformed post");
  if (!["draft", "schedule", "now"].includes(input.mode)) throw new ApiError(400, "Invalid mode");
  const caption = String(input.caption ?? "");
  const media = getMediaRows(input.mediaIds);
  if (media.length !== input.mediaIds.length) throw new ApiError(400, "Some media no longer exists");
  if (media.some((m) => m.purged_at != null)) throw new ApiError(400, "Some media was deleted after it was published. Remove it from the post and upload it again.");
  if (!input.targets.length && input.mode !== "draft") throw new ApiError(422, "Choose at least one account.");

  const seen = new Set<string>();
  const extraIds = input.targets.flatMap((t) => [t.options?.thumbnailMediaId, t.options?.coverMediaId]).filter((x): x is string => !!x);
  const extra = new Map(getMediaRows(extraIds).map((m) => [m.id, m]));
  if ([...extra.values()].some((m) => m.purged_at != null)) throw new ApiError(400, "A thumbnail or cover was deleted after it was published. Choose another.");
  const lookup = (id: string) => extra.get(id);
  const scheduledAt = input.mode === "now" ? now : input.scheduledAt ?? null;

  const issues: Record<string, Issue[]> = {};
  for (const t of input.targets) {
    const account = getAccountRow(t.accountId);
    if (!account) throw new ApiError(400, "Unknown account");
    if (seen.has(t.accountId)) throw new ApiError(400, "An account can only be targeted once per post");
    seen.add(t.accountId);
    const info = CONTENT_TYPES[t.contentType];
    if (!info || info.platform !== account.platform) throw new ApiError(400, `Invalid content type for ${account.platform}`);
    t.options = sanitizeOptions(t.options ?? {});
    if (input.mode !== "draft") {
      const errs = validateTarget({ contentType: t.contentType, options: t.options, caption, media, lookup, scheduledAt, mode: input.mode, now })
        .filter((i) => i.level === "error");
      if (errs.length) issues[t.accountId] = errs;
    }
  }
  if (Object.keys(issues).length) throw new ApiError(422, "Fix the highlighted problems before scheduling.", { issues });

  const d = db();
  const id = existingId ?? randomId(9);
  d.transaction(() => {
    if (existingId) {
      const current = getPost(existingId);
      if (!current) throw new ApiError(404, "Post not found");
      if (!current.editable) throw new ApiError(409, "This post has already been published or is publishing and can't be edited.");
      d.prepare("UPDATE posts SET caption = ?, scheduled_at = ?, updated_at = ? WHERE id = ?").run(caption, scheduledAt, now, id);
      d.prepare("DELETE FROM post_media WHERE post_id = ?").run(id);
      d.prepare("DELETE FROM post_targets WHERE post_id = ?").run(id);
    } else {
      d.prepare("INSERT INTO posts (id, caption, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, caption, scheduledAt, now, now);
    }
    input.mediaIds.forEach((mid, i) => d.prepare("INSERT INTO post_media (post_id, media_id, position) VALUES (?, ?, ?)").run(id, mid, i));
    for (const t of input.targets) {
      const tid = randomId(9);
      const status: TargetStatus = input.mode === "draft" ? "draft" : "scheduled";
      const dispatchAt = status === "scheduled" && scheduledAt != null ? computeDispatchAt(t.contentType, t.options, scheduledAt, now) : null;
      d.prepare(
        `INSERT INTO post_targets (id, post_id, account_id, content_type, options, status, dispatch_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(tid, id, t.accountId, t.contentType, JSON.stringify(t.options), status, dispatchAt, now);
      if (status === "scheduled") addEvent(tid, "info", input.mode === "now" ? "Queued to publish now." : `Scheduled for ${new Date(scheduledAt!).toISOString()}.`);
    }
  })();
  return getPost(id)!;
}

/** Moves a scheduled post to a new time (calendar drag & drop). */
export function reschedulePost(id: string, scheduledAt: number, now = Date.now()): Post {
  const post = getPost(id);
  if (!post) throw new ApiError(404, "Post not found");
  if (!post.editable) throw new ApiError(409, "This post can no longer be moved.");
  if (scheduledAt < now - 60_000) throw new ApiError(422, "Can't move a post into the past.");
  const d = db();
  d.transaction(() => {
    d.prepare("UPDATE posts SET scheduled_at = ?, updated_at = ? WHERE id = ?").run(scheduledAt, now, id);
    for (const t of post.targets) {
      if (t.status !== "scheduled") continue;
      d.prepare("UPDATE post_targets SET dispatch_at = ?, updated_at = ? WHERE id = ?")
        .run(computeDispatchAt(t.contentType, t.options, scheduledAt, now), now, t.id);
      addEvent(t.id, "info", `Rescheduled to ${new Date(scheduledAt).toISOString()}.`);
    }
  })();
  return getPost(id)!;
}

export function deletePost(id: string) {
  const post = getPost(id);
  if (!post) throw new ApiError(404, "Post not found");
  if (post.targets.some((t) => t.status === "publishing")) throw new ApiError(409, "Post is publishing right now; try again in a moment.");
  db().prepare("DELETE FROM posts WHERE id = ?").run(id);
}

export function retryPost(id: string, now = Date.now()): Post {
  const post = getPost(id);
  if (!post) throw new ApiError(404, "Post not found");
  const failed = post.targets.filter((t) => t.status === "failed");
  if (!failed.length) throw new ApiError(409, "Nothing to retry.");
  const d = db();
  d.transaction(() => {
    for (const t of failed) {
      d.prepare("UPDATE post_targets SET status = 'scheduled', dispatch_at = ?, attempts = 0, error = NULL, updated_at = ? WHERE id = ?").run(now, now, t.id);
      addEvent(t.id, "info", "Retry requested.");
    }
  })();
  return getPost(id)!;
}
