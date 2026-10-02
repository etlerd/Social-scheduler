// Disk accounting for DATA_DIR, which on Railway Hobby is a fixed 5 GB volume.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";
import type { HeldBy, StorageBreakdown, StorageLevel, StorageReport } from "./types";
import { toMediaItem, type MediaRow } from "./media";

/** Kept free so the database and previews can always be written: 2% of the budget, at most 100 MB. */
export function reserveBytes(): number {
  return Math.min(100 * 1024 * 1024, Math.round(config.storageLimitBytes * 0.02));
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function dirSize(dir: string): number {
  let total = 0;
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) total += fileSize(path.join(dir, name));
  return total;
}

/** Which unpublished posts hold each media file, split by whether any of them is still on its way out. */
function holders(): Map<string, Exclude<HeldBy, "unused">> {
  const rows = db()
    .prepare(
      `WITH uses AS (
         SELECT pm.media_id AS mid, t.status FROM post_media pm JOIN post_targets t ON t.post_id = pm.post_id
         UNION ALL SELECT json_extract(options, '$.thumbnailMediaId'), status FROM post_targets
         UNION ALL SELECT json_extract(options, '$.coverMediaId'), status FROM post_targets
       )
       SELECT mid, MAX(status IN ('draft','scheduled','publishing')) AS waiting, MAX(status = 'failed') AS failed
       FROM uses WHERE mid IS NOT NULL GROUP BY mid`,
    )
    .all() as { mid: string; waiting: number; failed: number }[];
  const out = new Map<string, Exclude<HeldBy, "unused">>();
  for (const r of rows) {
    if (r.waiting) out.set(r.mid, "waiting");
    else if (r.failed) out.set(r.mid, "failed");
  }
  return out;
}

let cache: { at: number; report: StorageReport } | null = null;

export function invalidateStorage() {
  cache = null;
}

export function storageReport(): StorageReport {
  if (cache && Date.now() - cache.at < 15_000) return cache.report;
  const media = db().prepare("SELECT * FROM media WHERE purged_at IS NULL").all() as MediaRow[];
  const held = holders();
  const breakdown: StorageBreakdown = { waiting: 0, failed: 0, unused: 0, app: 0 };
  const sized = media.map((m) => {
    const size = fileSize(path.join(config.mediaDir, m.file_name)) || m.size;
    const heldBy: HeldBy = held.get(m.id) ?? "unused";
    breakdown[heldBy] += size;
    return { ...toMediaItem(m), size, heldBy };
  });
  const thumbs = (db().prepare("SELECT thumb_file FROM media WHERE thumb_file IS NOT NULL").all() as { thumb_file: string }[])
    .reduce((n, r) => n + fileSize(path.join(config.mediaDir, r.thumb_file)), 0);
  const dbFiles = ["app.db", "app.db-wal", "app.db-shm"].reduce((n, f) => n + fileSize(path.join(config.dataDir, f)), 0);
  breakdown.app = thumbs + dbFiles;

  // Anything else on the volume (stray files, partial uploads) still counts against the limit.
  const counted = breakdown.waiting + breakdown.failed + breakdown.unused + breakdown.app;
  const onDisk = dirSize(config.mediaDir) + dbFiles;
  breakdown.app += Math.max(0, onDisk - counted);
  let used = Math.max(counted, onDisk);
  let limit = config.storageLimitBytes;
  // If the real volume is smaller or fuller than the configured budget, trust the volume.
  try {
    const st = fs.statfsSync(config.dataDir);
    const volumeFree = st.bavail * st.bsize;
    if (volumeFree < limit - used) limit = used + volumeFree;
  } catch {}
  const free = Math.max(0, limit - used);
  const ratio = used / limit;
  const level: StorageLevel = free <= reserveBytes() ? "full" : ratio >= 0.95 ? "critical" : ratio >= config.storageWarnRatio ? "warn" : "ok";
  const report: StorageReport = {
    limit,
    used,
    free,
    uploadable: Math.max(0, free - reserveBytes()),
    level,
    breakdown,
    largest: sized.sort((a, b) => b.size - a.size).slice(0, 12),
  };
  cache = { at: Date.now(), report };
  return report;
}

/** Bytes an upload may use: free space minus the reserve. */
export function uploadAllowance(): number {
  return Math.max(0, storageReport().free - reserveBytes());
}

/** Of the given media ids, those no unpublished post holds (safe to delete). */
export function deletableIds(ids: string[]): string[] {
  const held = holders();
  return ids.filter((id) => !held.has(id) && db().prepare("SELECT 1 FROM media WHERE id = ? AND purged_at IS NULL").get(id));
}

/** All library files no unpublished post holds, largest first. */
export function unusedMedia(): { id: string; size: number }[] {
  const held = holders();
  return (db().prepare("SELECT id, file_name, size FROM media WHERE purged_at IS NULL").all() as { id: string; file_name: string; size: number }[])
    .filter((m) => !held.has(m.id))
    .map((m) => ({ id: m.id, size: fileSize(path.join(config.mediaDir, m.file_name)) || m.size }))
    .sort((a, b) => b.size - a.size);
}
