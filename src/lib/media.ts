import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";
import type { MediaItem } from "./types";

export interface MediaRow {
  id: string;
  file_name: string;
  original_name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  kind: "image" | "video";
  created_at: number;
  purged_at?: number | null;
  thumb_file?: string | null;
}

export const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi",
  "video/mpeg": ".mpeg",
  "video/3gpp": ".3gp",
};

export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]),
);

export function toMediaItem(r: MediaRow): MediaItem {
  return {
    id: r.id,
    url: `/media/${r.file_name}`,
    thumbUrl: r.thumb_file ? `/media/${r.thumb_file}` : null,
    originalName: r.original_name,
    mime: r.mime,
    size: r.size,
    width: r.width,
    height: r.height,
    duration: r.duration,
    kind: r.kind,
    createdAt: r.created_at,
    purged: r.purged_at != null,
  };
}

/** Absolute URL the platforms download from. */
export function publicMediaUrl(r: MediaRow): string {
  return `${config.publicUrl}/media/${r.file_name}`;
}

export function mediaFilePath(r: Pick<MediaRow, "file_name">): string {
  return path.join(config.mediaDir, path.basename(r.file_name));
}

const PENDING = "('draft','scheduled','publishing','failed')";

/** Unpublished posts per media id, in one pass (media attached to posts plus thumbnails/covers). */
function pendingUsage(): Map<string, number> {
  const rows = db()
    .prepare(
      `WITH uses AS (
         SELECT pm.media_id AS mid, pm.post_id FROM post_media pm
           WHERE EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = pm.post_id AND t.status IN ${PENDING})
         UNION SELECT json_extract(options, '$.thumbnailMediaId'), post_id FROM post_targets WHERE status IN ${PENDING}
         UNION SELECT json_extract(options, '$.coverMediaId'), post_id FROM post_targets WHERE status IN ${PENDING}
       )
       SELECT mid, COUNT(DISTINCT post_id) AS n FROM uses WHERE mid IS NOT NULL GROUP BY mid`,
    )
    .all() as { mid: string; n: number }[];
  return new Map(rows.map((r) => [r.mid, r.n]));
}

export function listMedia(): MediaItem[] {
  const usage = pendingUsage();
  return (db().prepare("SELECT * FROM media WHERE purged_at IS NULL ORDER BY created_at DESC").all() as MediaRow[]).map((r) => ({
    ...toMediaItem(r),
    pendingPosts: usage.get(r.id) ?? 0,
  }));
}

export function countMedia(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM media WHERE purged_at IS NULL").get() as { n: number }).n;
}

export function getMediaRow(id: string): MediaRow | undefined {
  return db().prepare("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | undefined;
}

/** Resolves a public file name: the original (until purged) or its thumbnail (kept after purge). */
export function resolveMediaFile(fileName: string): { row: MediaRow; thumb: boolean } | undefined {
  const row = db().prepare("SELECT * FROM media WHERE file_name = ? OR thumb_file = ?").get(fileName, fileName) as MediaRow | undefined;
  if (!row) return undefined;
  const thumb = row.thumb_file === fileName;
  if (!thumb && row.purged_at != null) return undefined;
  return { row, thumb };
}

export function setThumb(id: string, thumbFile: string) {
  db().prepare("UPDATE media SET thumb_file = ? WHERE id = ?").run(thumbFile, id);
}

export function getMediaRows(ids: string[]): MediaRow[] {
  if (!ids.length) return [];
  const rows = db()
    .prepare(`SELECT * FROM media WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as MediaRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is MediaRow => !!r);
}

export function insertMedia(r: MediaRow) {
  db()
    .prepare(
      `INSERT INTO media (id, file_name, original_name, mime, size, width, height, duration, kind, created_at)
       VALUES (@id, @file_name, @original_name, @mime, @size, @width, @height, @duration, @kind, @created_at)`,
    )
    .run((({ purged_at: _, ...rest }) => rest)(r));
}

/** Posts that still need this media (not yet fully published). */
export function mediaInUse(id: string): number {
  const direct = db()
    .prepare(
      `SELECT COUNT(DISTINCT pm.post_id) AS n FROM post_media pm
       JOIN post_targets t ON t.post_id = pm.post_id
       WHERE pm.media_id = ? AND t.status IN ('draft','scheduled','publishing','failed')`,
    )
    .get(id) as { n: number };
  const viaOptions = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM post_targets
       WHERE status IN ('draft','scheduled','publishing','failed')
       AND (json_extract(options, '$.thumbnailMediaId') = ? OR json_extract(options, '$.coverMediaId') = ?)`,
    )
    .get(id, id) as { n: number };
  return direct.n + viaOptions.n;
}

export function deleteMedia(id: string): boolean {
  const row = getMediaRow(id);
  if (!row) return false;
  db().transaction(() => {
    db().prepare("DELETE FROM post_media WHERE media_id = ?").run(id);
    db().prepare("DELETE FROM media WHERE id = ?").run(id);
  })();
  // Synchronous so storage accounting right after a delete sees the space as free.
  fs.rmSync(mediaFilePath(row), { force: true });
  if (row.thumb_file) fs.rmSync(mediaFilePath({ file_name: row.thumb_file }), { force: true });
  return true;
}

/**
 * Deletes the files of media whose every referencing post has finished publishing
 * (published, or handed to YouTube's scheduler). Media used by a draft, scheduled,
 * publishing or failed post is kept, and so is library media no post has used.
 * The row stays (marked purged) so published posts keep their history.
 */
export function purgePublishedMedia(postId?: string): number {
  const candidates = (
    postId
      ? db()
          .prepare(
            `SELECT media_id AS id FROM post_media WHERE post_id = ?
             UNION SELECT json_extract(options, '$.thumbnailMediaId') FROM post_targets WHERE post_id = ?
             UNION SELECT json_extract(options, '$.coverMediaId') FROM post_targets WHERE post_id = ?`,
          )
          .all(postId, postId, postId)
      : db()
          .prepare(
            `SELECT media_id AS id FROM post_media
             UNION SELECT json_extract(options, '$.thumbnailMediaId') FROM post_targets
             UNION SELECT json_extract(options, '$.coverMediaId') FROM post_targets`,
          )
          .all()
  ) as { id: string | null }[];
  let n = 0;
  const usage = pendingUsage();
  for (const { id } of candidates) {
    if (!id) continue;
    const row = getMediaRow(id);
    if (!row || row.purged_at != null || (usage.get(id) ?? 0) > 0) continue;
    fs.rmSync(mediaFilePath(row), { force: true });
    db().prepare("UPDATE media SET purged_at = ? WHERE id = ?").run(Date.now(), id);
    n++;
  }
  return n;
}
