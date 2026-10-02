"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { fmtBytes } from "@/lib/format";
import type { HeldBy, StorageBreakdown, StorageReport } from "@/lib/types";
import { LEVEL, pct, storageChanged, useStorage } from "./storage";
import { toast } from "./toast";
import { MediaThumb, Sheet, Spinner } from "./ui";

type Part = keyof StorageBreakdown;

// Fixed order = fixed colour slot; never re-sorted by size.
const PARTS: { key: Part; label: string; swatch: string; note: string }[] = [
  { key: "waiting", label: "Waiting to publish", swatch: "bg-s1", note: "Scheduled posts and drafts. Deleted automatically once published." },
  { key: "failed", label: "Held by failed posts", swatch: "bg-s2", note: "Kept so you can retry. Retry or delete those posts to free it." },
  { key: "unused", label: "Not in any post", swatch: "bg-s3", note: "Library uploads no unpublished post uses. Safe to delete." },
  { key: "app", label: "App data", swatch: "bg-s4", note: "Database and small previews." },
];

const HELD: Record<HeldBy, { label: string; cls: string }> = {
  waiting: { label: "Waiting to publish", cls: "bg-s1/15 text-ink" },
  failed: { label: "Failed post", cls: "bg-s2/15 text-ink" },
  unused: { label: "Not in any post", cls: "bg-s3/15 text-ink" },
};

export function StoragePanel() {
  const r = useStorage();
  const [hover, setHover] = useState<{ part: Part; x: number } | null>(null);
  const [confirm, setConfirm] = useState<null | { ids?: string[]; all?: boolean; bytes: number; count: number }>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string[]>([]);

  if (!r) {
    return (
      <section id="storage" className="card p-4 mb-5 flex justify-center text-muted">
        <Spinner />
      </section>
    );
  }

  const l = LEVEL[r.level];
  const unusedFiles = r.largest.filter((m) => m.heldBy === "unused");
  const selBytes = r.largest.filter((m) => sel.includes(m.id)).reduce((n, m) => n + m.size, 0);

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await api<{ deleted: number; freed: number; storage: StorageReport }>("/api/storage/cleanup", {
        method: "POST",
        json: confirm.all ? { all: true } : { ids: confirm.ids },
      });
      storageChanged(res.storage);
      window.dispatchEvent(new Event("media-changed"));
      toast(`Deleted ${res.deleted} file${res.deleted === 1 ? "" : "s"}, freed ${fmtBytes(res.freed)}`);
      setSel([]);
      setConfirm(null);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="storage" className="card p-4 md:p-5 mb-5 scroll-mt-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mb-3">
        <div>
          <h2 className="text-sm font-semibold">Storage</h2>
          <p className="mt-1">
            <span className="text-3xl font-semibold tabular-nums tracking-tight">{fmtBytes(r.used)}</span>
            <span className="text-muted"> of {fmtBytes(r.limit)}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm tabular-nums">{fmtBytes(r.free)} free</p>
          {r.level !== "ok" ? (
            <p className={`text-xs font-medium ${l.text}`}><span aria-hidden="true">{l.icon}</span> {l.label}</p>
          ) : (
            <p className="text-xs text-muted">{Math.round(pct(r))}% used</p>
          )}
        </div>
      </div>

      {/* Stacked part-to-whole bar; the empty track is free space. */}
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <div className="flex h-4 w-full gap-[2px] rounded-md bg-surface-2 overflow-hidden" role="img" aria-label={PARTS.map((p) => `${p.label} ${fmtBytes(r.breakdown[p.key])}`).join(", ")}>
          {PARTS.map((p) => {
            const w = (r.breakdown[p.key] / r.limit) * 100;
            if (w <= 0) return null;
            return (
              <div
                key={p.key}
                className={`${p.swatch} h-full first:rounded-l-md last:rounded-r-[4px] cursor-default`}
                style={{ width: `${Math.max(w, 0.6)}%` }}
                onMouseEnter={(e) => {
                  const box = e.currentTarget.parentElement!.getBoundingClientRect();
                  const seg = e.currentTarget.getBoundingClientRect();
                  setHover({ part: p.key, x: seg.left - box.left + seg.width / 2 });
                }}
              />
            );
          })}
        </div>
        {r.level !== "ok" && (
          // Where uploads stop (limit minus reserve).
          <div className="absolute -top-1 -bottom-1 w-[2px] bg-ink/60" style={{ left: `${((r.limit - (r.free - r.uploadable)) / r.limit) * 100}%` }} title="Uploads stop here" />
        )}
        {hover && (
          <div className="absolute -top-2 -translate-y-full -translate-x-1/2 z-10 rounded-lg bg-ink text-bg text-xs px-2.5 py-1.5 whitespace-nowrap pointer-events-none" style={{ left: hover.x }}>
            {PARTS.find((p) => p.key === hover.part)!.label}: <b className="tabular-nums">{fmtBytes(r.breakdown[hover.part])}</b>
            <span className="opacity-70"> · {((r.breakdown[hover.part] / r.limit) * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* Legend doubles as the table view. */}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {PARTS.map((p) => (
          <li key={p.key} className="flex gap-3 rounded-xl bg-surface-2/60 px-3 py-2.5">
            <span className={`mt-1 w-2.5 h-2.5 rounded-sm shrink-0 ${p.swatch}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-sm tabular-nums">{fmtBytes(r.breakdown[p.key])}</span>
              </div>
              <p className="text-xs text-muted mt-0.5">{p.note}</p>
              {p.key === "unused" && r.breakdown.unused > 0 && (
                <button className="btn-ghost btn-sm mt-2" onClick={() => setConfirm({ all: true, bytes: r.breakdown.unused, count: -1 })}>
                  Delete all unused ({fmtBytes(r.breakdown.unused)})
                </button>
              )}
              {p.key === "failed" && r.breakdown.failed > 0 && (
                <Link href="/posts?tab=failed" className="btn-ghost btn-sm mt-2">Review failed posts</Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      {r.largest.length > 0 && (
        <details className="mt-4 group" open={r.level !== "ok"}>
          <summary className="text-sm font-medium cursor-pointer select-none">Largest files</summary>
          <ul className="mt-3 divide-y divide-line">
            {r.largest.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                {m.heldBy === "unused" ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${m.originalName}`}
                    checked={sel.includes(m.id)}
                    onChange={(e) => setSel((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))}
                  />
                ) : (
                  <span className="w-[13px]" />
                )}
                <MediaThumb media={m} className="w-10 h-10 rounded-lg shrink-0" showMeta={false} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{m.originalName}</p>
                  <span className={`chip h-5 mt-0.5 ${HELD[m.heldBy].cls}`}>{HELD[m.heldBy].label}</span>
                </div>
                <span className="text-sm tabular-nums shrink-0">{fmtBytes(m.size)}</span>
              </li>
            ))}
          </ul>
          {unusedFiles.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <button className="text-xs text-accent" onClick={() => setSel(sel.length === unusedFiles.length ? [] : unusedFiles.map((m) => m.id))}>
                {sel.length === unusedFiles.length ? "Clear selection" : "Select all unused"}
              </button>
              {sel.length > 0 && (
                <button className="btn-danger btn-sm ml-auto" onClick={() => setConfirm({ ids: sel, bytes: selBytes, count: sel.length })}>
                  Delete {sel.length} ({fmtBytes(selBytes)})
                </button>
              )}
            </div>
          )}
        </details>
      )}

      <Sheet open={!!confirm} onClose={() => !busy && setConfirm(null)} title="Delete files?">
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm">
              {confirm.count === -1 ? "Every library file that no scheduled, draft or failed post uses" : `${confirm.count} file${confirm.count > 1 ? "s" : ""}`} will be deleted from this server,
              freeing about <b>{fmtBytes(confirm.bytes)}</b>.
            </p>
            <p className="text-sm text-muted">
              This can&apos;t be undone. Posts already published on Instagram and YouTube are not affected. Files used by any unpublished post are always skipped.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn-primary !bg-bad" disabled={busy} onClick={run}>
                {busy && <Spinner />} Delete
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </section>
  );
}
