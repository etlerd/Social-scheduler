// In-process scheduler. Claims due targets atomically, publishes them, and retries transient
// failures with backoff. Started from src/instrumentation.ts.
import { db } from "./db";
import { flagReconnect, getAccountRow, listAccountRows } from "./accounts";
import { getMediaRow } from "./media";
import { addEvent, getPostRow, getTargetRow, postMediaRows } from "./posts";
import { PublishError, errorMessage } from "./errors";
import { publishTarget } from "./providers";
import { igRefreshIfNeeded } from "./providers/instagram";
import type { TargetOptions } from "./types";

const TICK_MS = 15_000;
const CONCURRENCY = 3;
export const MAX_ATTEMPTS = 3;

const g = globalThis as unknown as { __ssWorker?: { timer: NodeJS.Timeout; inFlight: Map<string, Promise<void>> } };
const inFlight: Map<string, Promise<void>> = g.__ssWorker?.inFlight ?? new Map();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function processTarget(id: string, deps: { sleep?: (ms: number) => Promise<void> } = {}): Promise<void> {
  const target = getTargetRow(id);
  if (!target) return;
  const post = getPostRow(target.post_id);
  const account = getAccountRow(target.account_id);
  const d = db();
  const log = (level: "info" | "warn" | "error", msg: string) => addEvent(id, level, msg);
  if (!post || !account) {
    d.prepare("UPDATE post_targets SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run("Post or account no longer exists.", Date.now(), id);
    return;
  }
  log("info", `Publishing (attempt ${target.attempts}).`);
  try {
    const result = await publishTarget({
      target,
      options: JSON.parse(target.options) as TargetOptions,
      account,
      post,
      media: postMediaRows(post.id),
      lookupMedia: (mid) => getMediaRow(mid),
      log,
      saveContainer: (cid) => d.prepare("UPDATE post_targets SET container_id = ? WHERE id = ?").run(cid, id),
      now: () => Date.now(),
      sleep: deps.sleep ?? sleep,
    });
    d.prepare(
      `UPDATE post_targets SET status = ?, external_id = ?, external_url = ?, error = NULL, published_at = ?, updated_at = ? WHERE id = ?`,
    ).run(result.status, result.externalId ?? null, result.externalUrl ?? null, Date.now(), Date.now(), id);
    log("info", result.status === "platform_scheduled" ? "Handed off; the platform will publish at the scheduled time." : "Published.");
  } catch (e) {
    const pe = e instanceof PublishError ? e : new PublishError(errorMessage(e), { retryable: false });
    if (pe.reconnect) flagReconnect(account.id, pe.message);
    const fresh = getTargetRow(id)!;
    if (pe.retryable && fresh.attempts < MAX_ATTEMPTS) {
      const delay = 2 ** fresh.attempts * 60_000;
      d.prepare("UPDATE post_targets SET status = 'scheduled', dispatch_at = ?, error = ?, updated_at = ? WHERE id = ?")
        .run(Date.now() + delay, pe.message, Date.now(), id);
      log("warn", `${pe.message} Retrying in ${delay / 60_000} min.`);
    } else {
      d.prepare("UPDATE post_targets SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(pe.message, Date.now(), id);
      log("error", pe.message);
    }
  }
}

/** Claims and starts due targets. Returns the promises for the jobs it started. */
export function runDue(now = Date.now()): Promise<void>[] {
  const slots = CONCURRENCY - inFlight.size;
  if (slots <= 0) return [];
  const due = db()
    .prepare("SELECT id FROM post_targets WHERE status = 'scheduled' AND dispatch_at <= ? ORDER BY dispatch_at LIMIT ?")
    .all(now, slots) as { id: string }[];
  const started: Promise<void>[] = [];
  for (const { id } of due) {
    if (inFlight.has(id)) continue;
    const claimed = db()
      .prepare("UPDATE post_targets SET status = 'publishing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'scheduled'")
      .run(Date.now(), id).changes;
    if (!claimed) continue;
    const p = processTarget(id)
      .catch((e) => console.error("[worker]", e))
      .finally(() => inFlight.delete(id));
    inFlight.set(id, p);
    started.push(p);
  }
  return started;
}

/**
 * Targets left in 'publishing' by a crash. Instagram and resumable YouTube uploads saved a
 * container/session and can resume safely; anything else might already be live, so it fails
 * with a message instead of risking a duplicate post.
 */
export function recoverInterrupted() {
  const rows = db().prepare("SELECT id, container_id, account_id FROM post_targets WHERE status = 'publishing'").all() as {
    id: string;
    container_id: string | null;
    account_id: string;
  }[];
  for (const r of rows) {
    if (inFlight.has(r.id)) continue;
    const demo = getAccountRow(r.account_id)?.mode === "demo";
    if (r.container_id || demo) {
      db().prepare("UPDATE post_targets SET status = 'scheduled', dispatch_at = ?, updated_at = ? WHERE id = ?").run(Date.now(), Date.now(), r.id);
      addEvent(r.id, "warn", "Server restarted mid-publish; resuming.");
    } else {
      const msg = "Server restarted mid-publish. Check the platform before retrying to avoid a duplicate.";
      db().prepare("UPDATE post_targets SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(msg, Date.now(), r.id);
      addEvent(r.id, "error", msg);
    }
  }
}

let lastRefresh = 0;
async function refreshTokens() {
  if (Date.now() - lastRefresh < 6 * 3600_000) return;
  lastRefresh = Date.now();
  for (const a of listAccountRows()) {
    if (a.mode !== "live" || a.platform !== "instagram" || a.status !== "ok") continue;
    try {
      await igRefreshIfNeeded(a, true);
    } catch (e) {
      if (e instanceof PublishError && e.reconnect) flagReconnect(a.id, e.message);
      console.error(`[worker] token refresh failed for ${a.name}:`, errorMessage(e));
    }
  }
}

export function startWorker() {
  if (g.__ssWorker) return;
  recoverInterrupted();
  const tick = () => {
    try {
      runDue();
      void refreshTokens();
    } catch (e) {
      console.error("[worker] tick failed", e);
    }
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  g.__ssWorker = { timer, inFlight };
  setTimeout(tick, 2000);
  console.log("[worker] scheduler started");
}
