"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { fmtBytes, fmtDuration } from "@/lib/format";
import type { MediaItem } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { IconTrash, IconUpload } from "./icons";
import { UploadJobs } from "./MediaPicker";
import { Banner, Empty, MediaThumb, Sheet, Spinner } from "./ui";
import { useUploader } from "./upload";
import { StoragePanel } from "./StoragePanel";
import { storageChanged } from "./storage";

export function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const { jobs, upload, dismiss } = useUploader(useCallback((m: MediaItem) => setItems((xs) => [m, ...(xs ?? [])]), []));

  const [sort, setSort] = useState<"newest" | "largest">("newest");
  useEffect(() => {
    const load = () => api<{ media: MediaItem[] }>("/api/media").then((r) => setItems(r.media)).catch((e) => setError(e.message));
    load();
    window.addEventListener("media-changed", load);
    return () => window.removeEventListener("media-changed", load);
  }, []);

  const remove = async (m: MediaItem) => {
    if (!confirm(`Delete ${m.originalName}? Published posts are unaffected.`)) return;
    try {
      await api(`/api/media/${m.id}`, { method: "DELETE" });
      setItems((xs) => xs?.filter((x) => x.id !== m.id) ?? null);
      setOpen(null);
      storageChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const shown = (items ?? [])
    .filter((m) => filter === "all" || m.kind === filter)
    .sort((a, b) => (sort === "largest" ? b.size - a.size : b.createdAt - a.createdAt));

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
            <button className="btn-ghost btn-sm md:h-10 md:px-4 md:text-sm" onClick={() => { setSelecting((v) => !v); setSel([]); }}>{selecting ? "Cancel" : "Select"}</button>
            <button className="btn-primary btn-sm md:h-10 md:px-4 md:text-sm" onClick={() => fileRef.current?.click()}><IconUpload size={16} /> Upload</button>
            <input ref={fileRef} type="file" hidden multiple accept="image/*,video/*" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
          </>
        }
      />
      <StoragePanel />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="seg">
          {(["all", "image", "video"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "image" ? "Photos" : "Videos"}</button>
          ))}
        </div>
        <div className="seg ml-auto">
          <button aria-pressed={sort === "newest"} onClick={() => setSort("newest")}>Newest</button>
          <button aria-pressed={sort === "largest"} onClick={() => setSort("largest")}>Largest</button>
        </div>
      </div>
      {error && <div className="mb-4" onClick={() => setError("")}><Banner tone="error">{error}</Banner></div>}
      <div className="mb-4"><UploadJobs jobs={jobs} dismiss={dismiss} /></div>
      {items === null ? (
        <div className="flex justify-center py-10 text-muted"><Spinner size={20} /></div>
      ) : shown.length === 0 ? (
        <Empty title="No media yet">Upload photos and videos here or straight from the composer. Images are converted to JPEG for Instagram automatically.</Empty>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2" data-testid="library">
          {shown.map((m) => (
            <button
              key={m.id}
              onClick={() => (selecting ? setSel((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id])) : setOpen(m))}
              className={`relative rounded-xl overflow-hidden ring-2 ${sel.includes(m.id) ? "ring-accent" : "ring-transparent"}`}
              aria-pressed={selecting ? sel.includes(m.id) : undefined}
            >
              <MediaThumb media={m} className="aspect-square" />
              {selecting && (
                <span className={`absolute top-1.5 right-1.5 grid place-items-center w-6 h-6 rounded-full text-xs font-semibold border-2 ${sel.includes(m.id) ? "bg-accent border-accent text-accent-ink" : "border-white/90 bg-black/30"}`}>
                  {sel.includes(m.id) ? sel.indexOf(m.id) + 1 : ""}
                </span>
              )}
              {sort === "largest" && (
                <span className="absolute right-1.5 bottom-1.5 chip h-5 px-1.5 bg-black/60 text-white text-[10px] tabular-nums">{fmtBytes(m.size)}</span>
              )}
              {!selecting && (m.pendingPosts ?? 0) > 0 && (
                <span className="absolute top-1.5 left-1.5 chip h-5 px-1.5 bg-black/60 text-white text-[10px]">In {m.pendingPosts} post{m.pendingPosts! > 1 ? "s" : ""}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {selecting && sel.length > 0 && (
        <div className="sticky bottom-20 md:bottom-4 z-30 mt-4 card p-3 flex items-center gap-2 shadow-lg">
          <span className="text-sm flex-1">{sel.length} selected</span>
          <button className="btn-ghost btn-sm" onClick={() => setSel([])}>Clear</button>
          <button className="btn-primary btn-sm" onClick={() => router.push(`/compose?media=${sel.join(",")}`)}>New post with {sel.length}</button>
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
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => router.push(`/compose?media=${open.id}`)}>New post with this</button>
              {(open.pendingPosts ?? 0) > 0 ? (
                <p className="text-xs text-muted self-center">Used by {open.pendingPosts} unpublished post{open.pendingPosts! > 1 ? "s" : ""}; deleted automatically after {open.pendingPosts! > 1 ? "they go" : "it goes"} out.</p>
              ) : (
                <button className="btn-danger" onClick={() => remove(open)}><IconTrash size={16} /> Delete</button>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
