"use client";

import { useEffect, type ReactNode } from "react";
import type { AccountSummary, MediaItem, PostStatus, TargetStatus } from "@/lib/types";
import { IconPlay, IconX, PlatformIcon } from "./icons";
import { fmtDuration } from "@/lib/format";

export function AccountAvatar({ account, size = 32, ring = false }: { account: Pick<AccountSummary, "name" | "avatarUrl" | "platform">; size?: number; ring?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {account.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={account.avatarUrl} alt="" className={`rounded-full object-cover w-full h-full ${ring ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`} />
      ) : (
        <span
          className={`rounded-full w-full h-full grid place-items-center font-semibold text-white ${ring ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
          style={{ fontSize: size * 0.4, background: account.platform === "instagram" ? "linear-gradient(135deg,#fa7e1e,#d62976,#4f5bd5)" : "#ff0033" }}
        >
          {account.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute -right-1 -bottom-1 rounded-full bg-surface p-[1px]">
        <PlatformIcon platform={account.platform} size={Math.max(12, size * 0.42)} />
      </span>
    </span>
  );
}

const STATUS_STYLE: Record<string, [string, string]> = {
  draft: ["Draft", "bg-surface-2 text-muted"],
  scheduled: ["Scheduled", "bg-accent/12 text-accent"],
  publishing: ["Publishing…", "bg-warn/15 text-warn"],
  published: ["Published", "bg-ok/15 text-ok"],
  platform_scheduled: ["Scheduled on platform", "bg-ok/15 text-ok"],
  partial: ["Partly failed", "bg-bad/12 text-bad"],
  failed: ["Failed", "bg-bad/12 text-bad"],
};

export function StatusBadge({ status }: { status: PostStatus | TargetStatus }) {
  const [label, cls] = STATUS_STYLE[status] ?? [status, "bg-surface-2 text-muted"];
  return <span className={`chip ${cls}`}>{label}</span>;
}

export function MediaThumb({ media, className = "", showMeta = true }: { media: MediaItem; className?: string; showMeta?: boolean }) {
  return (
    <div className={`relative overflow-hidden bg-surface-2 ${className}`}>
      {media.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt={media.originalName} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <video src={`${media.url}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover" />
      )}
      {showMeta && media.kind === "video" && (
        <span className="absolute left-1 bottom-1 chip h-5 px-1.5 bg-black/60 text-white gap-1">
          <IconPlay size={10} />
          {fmtDuration(media.duration)}
        </span>
      )}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted mt-2">{children}</div>}
    </div>
  );
}

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-surface w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"} max-h-[88dvh] flex flex-col rounded-t-3xl sm:rounded-2xl shadow-xl safe-bottom`}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-line shrink-0">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-muted hover:text-ink" aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: ReactNode }) {
  const cls = tone === "error" ? "border-bad/30 bg-bad/8 text-bad" : tone === "ok" ? "border-ok/30 bg-ok/8 text-ok" : "border-line bg-surface-2 text-ink";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}
