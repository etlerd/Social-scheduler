"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "@/lib/types";
import { fmtBytes } from "@/lib/format";
import { IconUpload, IconX } from "./icons";
import { MediaThumb, Sheet } from "./ui";
import { useUploader, type UploadJob } from "./upload";

export function UploadJobs({ jobs, dismiss }: { jobs: UploadJob[]; dismiss: (k: string) => void }) {
  if (!jobs.length) return null;
  return (
    <ul className="space-y-1.5">
      {jobs.map((j) => (
        <li key={j.key} className="flex items-center gap-2 text-xs">
          <span className="truncate flex-1">{j.name}</span>
          {j.error ? (
            <>
              <span className="text-bad truncate max-w-[60%]">{j.error}</span>
              <button onClick={() => dismiss(j.key)} aria-label="Dismiss"><IconX size={14} /></button>
            </>
          ) : (
            <span className="w-28 h-1.5 rounded bg-surface-2 overflow-hidden">
              <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Library picker. `multiple` returns an ordered selection; otherwise picks one and closes. */
export function MediaPicker({
  open,
  onClose,
  library,
  onLibraryAdd,
  kind,
  multiple = false,
  initial = [],
  onDone,
  title = "Media library",
}: {
  open: boolean;
  onClose: () => void;
  library: MediaItem[];
  onLibraryAdd: (m: MediaItem) => void;
  kind?: "image" | "video";
  multiple?: boolean;
  initial?: string[];
  onDone: (ids: string[]) => void;
  title?: string;
}) {
  const [sel, setSel] = useState<string[]>(initial);
  const fileRef = useRef<HTMLInputElement>(null);
  const { jobs, upload, dismiss } = useUploader((m) => {
    onLibraryAdd(m);
    if (!kind || m.kind === kind) setSel((s) => (multiple ? [...s, m.id] : [m.id]));
  });
  useEffect(() => {
    if (open) setSel(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const items = library.filter((m) => !kind || m.kind === kind);
  const toggle = (id: string) => {
    if (!multiple) {
      onDone([id]);
      onClose();
      return;
    }
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <Sheet open={open} onClose={onClose} title={title} wide>
      <div className="flex items-center gap-2 mb-4">
        <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
          <IconUpload size={14} /> Upload
        </button>
        <input ref={fileRef} type="file" hidden multiple={multiple} accept={kind === "image" ? "image/*" : kind === "video" ? "video/*" : "image/*,video/*"} onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
        {multiple && (
          <button className="btn-primary btn-sm ml-auto" onClick={() => { onDone(sel); onClose(); }}>
            Use {sel.length || ""} selected
          </button>
        )}
      </div>
      <UploadJobs jobs={jobs} dismiss={dismiss} />
      {items.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center">No {kind ? `${kind}s` : "media"} yet. Upload some.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mt-2">
          {items.map((m) => {
            const n = sel.indexOf(m.id);
            return (
              <button key={m.id} onClick={() => toggle(m.id)} className={`relative rounded-xl overflow-hidden text-left ring-2 ${n >= 0 ? "ring-accent" : "ring-transparent"}`} title={`${m.originalName} · ${fmtBytes(m.size)}`}>
                <MediaThumb media={m} className="aspect-square" />
                {n >= 0 && multiple && <span className="absolute top-1.5 right-1.5 grid place-items-center w-6 h-6 rounded-full bg-accent text-accent-ink text-xs font-semibold">{n + 1}</span>}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
