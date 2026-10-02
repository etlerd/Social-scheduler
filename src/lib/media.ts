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

export function listMedia(): MediaItem[] {
  return (db().prepare("SELECT * FROM media WHERE purged_at IS NULL ORDER BY created_at DESC").all() as MediaRow[]).map((r) => ({
    ...toMediaItem(r),
    pendingPosts: mediaInUse(r.id),
  }));
}

export function getMediaRow(id: string): MediaRow | undefined {
  return db().prepare("SELECT * FROM media WHERE id = ?").get(id) as MediaRow | undefined;
}

export function getMediaRowByFile(fileName: string): MediaRow | undefined {
  return db().prepare("SELECT * FROM media WHERE file_name = ? AND purged_at IS NULL").get(fileName) as MediaRow | undefined;
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
  fs.rm(mediaFilePath(row), { force: true }, () => {});
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
  for (const { id } of candidates) {
    if (!id) continue;
    const row = getMediaRow(id);
    if (!row || row.purged_at != null || mediaInUse(id) > 0) continue;
    fs.rmSync(mediaFilePath(row), { force: true });
    db().prepare("UPDATE media SET purged_at = ? WHERE id = ?").run(Date.now(), id);
    n++;
  }
  return n;
}
