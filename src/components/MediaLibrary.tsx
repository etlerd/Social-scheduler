"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtBytes, fmtDuration } from "@/lib/format";
import type { MediaItem } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { IconTrash, IconUpload } from "./icons";
import { UploadJobs } from "./MediaPicker";
import { Banner, Empty, MediaThumb, Sheet, Spinner } from "./ui";
import { useUploader } from "./upload";

export function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { jobs, upload, dismiss } = useUploader(useCallback((m: MediaItem) => setItems((xs) => [m, ...(xs ?? [])]), []));

  useEffect(() => {
    api<{ media: MediaItem[] }>("/api/media").then((r) => setItems(r.media)).catch((e) => setError(e.message));
  }, []);

  const remove = async (m: MediaItem) => {
    if (!confirm(`Delete ${m.originalName}? Published posts are unaffected.`)) return;
    try {
      await api(`/api/media/${m.id}`, { method: "DELETE" });
      setItems((xs) => xs?.filter((x) => x.id !== m.id) ?? null);
      setOpen(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const shown = (items ?? []).filter((m) => filter === "all" || m.kind === filter);

  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
      className={dragOver ? "ring-2 ring-accent rounded-2xl" : ""}
    >
      <PageHeader
        title="Media"
        actions={
          <>
            <button className="btn-primary btn-sm md:h-10 md:px-4 md:text-sm" onClick={() => fileRef.current?.click()}><IconUpload size={16} /> Upload</button>
            <input ref={fileRef} type="file" hidden multiple accept="image/*,video/*" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
          </>
        }
      />
      <div className="seg mb-4">
        {(["all", "image", "video"] as const).map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "image" ? "Photos" : "Videos"}</button>
        ))}
      </div>
      {error && <div className="mb-4" onClick={() => setError("")}><Banner tone="error">{error}</Banner></div>}
      <div className="mb-4"><UploadJobs jobs={jobs} dismiss={dismiss} /></div>
      {items === null ? (
        <div className="flex justify-center py-10 text-muted"><Spinner size={20} /></div>
      ) : shown.length === 0 ? (
        <Empty title="No media yet">Upload photos and videos here or straight from the composer. Images are converted to JPEG for Instagram automatically.</Empty>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {shown.map((m) => (
            <button key={m.id} onClick={() => setOpen(m)} className="rounded-xl overflow-hidden">
              <MediaThumb media={m} className="aspect-square" />
            </button>
          ))}
        </div>
      )}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.originalName ?? ""} wide>
        {open && (
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden bg-black grid place-items-center max-h-[55dvh]">
              {open.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={open.url} alt="" className="max-h-[55dvh] object-contain" />
              ) : (
                <video src={open.url} controls playsInline className="max-h-[55dvh]" />
              )}
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><dt className="text-muted text-xs">Type</dt><dd>{open.mime}</dd></div>
              <div><dt className="text-muted text-xs">Size</dt><dd>{fmtBytes(open.size)}</dd></div>
              <div><dt className="text-muted text-xs">Dimensions</dt><dd>{open.width && open.height ? `${open.width}×${open.height}` : "—"}</dd></div>
              <div><dt className="text-muted text-xs">Duration</dt><dd>{open.duration ? fmtDuration(open.duration) : "—"}</dd></div>
            </dl>
            <button className="btn-danger" onClick={() => remove(open)}><IconTrash size={16} /> Delete</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
