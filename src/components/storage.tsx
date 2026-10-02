"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtBytes } from "@/lib/format";
import type { StorageLevel, StorageReport } from "@/lib/types";

const EVENT = "storage-changed";
let current: StorageReport | null = null;
let inflight: Promise<void> | null = null;

/** Ask every storage view to refetch (after uploads, deletes, cleanup). */
export function storageChanged(next?: StorageReport) {
  if (next) current = next;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

async function refresh() {
  inflight ??= api<StorageReport>("/api/storage")
    .then((r) => {
      current = r;
      window.dispatchEvent(new CustomEvent(EVENT, { detail: r }));
    })
    .catch(() => {})
    .finally(() => (inflight = null));
  return inflight;
}

export function getStorage() {
  return current;
}

/** Shared, lightly polled storage report. */
export function useStorage(): StorageReport | null {
  const [r, setR] = useState<StorageReport | null>(current);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<StorageReport | undefined>).detail;
      if (d) setR(d);
      else refresh();
    };
    window.addEventListener(EVENT, on);
    if (!current) refresh();
    const t = setInterval(() => !document.hidden && refresh(), 60_000);
    return () => {
      window.removeEventListener(EVENT, on);
      clearInterval(t);
    };
  }, []);
  return r;
}

export const LEVEL: Record<StorageLevel, { label: string; fill: string; text: string; icon: string }> = {
  ok: { label: "", fill: "bg-accent", text: "text-muted", icon: "" },
  warn: { label: "Getting full", fill: "bg-warn", text: "text-warn", icon: "▲" },
  critical: { label: "Almost full", fill: "bg-bad", text: "text-bad", icon: "●" },
  full: { label: "Full: uploads paused", fill: "bg-bad", text: "text-bad", icon: "●" },
};

export const pct = (r: StorageReport) => Math.min(100, (r.used / r.limit) * 100);

/** Compact meter for the sidebar and page headers. */
export function StorageMeter({ r, className = "" }: { r: StorageReport; className?: string }) {
  const l = LEVEL[r.level];
  const p = pct(r);
  return (
    <Link href="/media#storage" className={`block rounded-xl px-3 py-2.5 hover:bg-surface-2 ${className}`} aria-label={`Storage: ${fmtBytes(r.used)} of ${fmtBytes(r.limit)} used`}>
      <div className="flex items-baseline justify-between text-xs mb-1.5">
        <span className="font-medium">Storage</span>
        <span className="text-muted tabular-nums">{fmtBytes(r.used)} / {fmtBytes(r.limit)}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}>
        <div className={`h-full rounded-full ${l.fill} transition-[width]`} style={{ width: `${Math.max(p, 2)}%` }} />
      </div>
      {r.level !== "ok" && (
        <p className={`text-xs mt-1.5 font-medium ${l.text}`}>
          <span aria-hidden="true">{l.icon}</span> {l.label}
        </p>
      )}
    </Link>
  );
}

/** App-wide banner once storage needs attention. Warnings can be hidden for the session; "full" can't. */
export function StorageBanner() {
  const r = useStorage();
  const [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem("storage-banner-hidden"));
    } catch {}
  }, []);
  if (!r || r.level === "ok" || (r.level === "warn" && hidden === "warn")) return null;
  const full = r.level === "full";
  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-2 ${r.level === "warn" ? "border-warn/40 bg-warn/10" : "border-bad/40 bg-bad/8"}`} role="status">
      <span className={`font-semibold ${LEVEL[r.level].text}`}>
        <span aria-hidden="true">{LEVEL[r.level].icon}</span> {full ? "Storage full" : `Storage ${Math.round(pct(r))}% full`}
      </span>
      <span className="flex-1 min-w-48 text-ink">
        {fmtBytes(r.used)} of {fmtBytes(r.limit)} used.{" "}
        {full
          ? "New uploads are paused. Scheduled posts still publish."
          : `Uploads stop when ${fmtBytes(r.uploadable)} more is used.`}
        {r.breakdown.unused > 0 && ` ${fmtBytes(r.breakdown.unused)} is in files no post uses.`}
      </span>
      <Link href="/media#storage" className="btn-primary btn-sm">Free up space</Link>
      {r.level === "warn" && (
        <button
          className="text-xs text-muted hover:text-ink"
          onClick={() => {
            setHidden("warn");
            try {
              sessionStorage.setItem("storage-banner-hidden", "warn");
            } catch {}
          }}
        >
          Hide
        </button>
      )}
    </div>
  );
}
