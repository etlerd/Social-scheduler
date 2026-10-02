"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ClientError } from "@/lib/client";
import { fmtBytes, fmtDuration, fromLocalInput, timeZoneName, toLocalInput } from "@/lib/format";
import { CONTENT_TYPES, PLATFORM_TYPES, YT_CATEGORIES, countHashtags, defaultOptions, tagsLength, usesNativeSchedule, validateTarget } from "@/lib/rules";
import type { AccountSummary, ContentType, Issue, MediaItem, Platform, Post, PostInput, TargetOptions } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { IconChevron, IconEye, IconImage, IconUpload, IconX } from "./icons";
import { MediaPicker, UploadJobs } from "./MediaPicker";
import { TargetPreview } from "./Previews";
import { AccountAvatar, Banner, MediaThumb, Sheet, Spinner } from "./ui";
import { useUploader } from "./upload";

interface TargetState {
  contentType: ContentType;
  options: TargetOptions;
  touched: boolean; // user picked the type explicitly; don't auto-switch it
}

type Mode = "schedule" | "now";

function inferType(platform: Platform, media: MediaItem[]): ContentType {
  const video = media.find((m) => m.kind === "video");
  if (platform === "instagram") {
    if (media.length > 1) return "ig_carousel";
    return video ? "ig_reel" : "ig_image";
  }
  if (video && video.width && video.height && video.height >= video.width && (video.duration ?? 0) <= 180) return "yt_short";
  return "yt_video";
}

function defaultWhen(date?: string): string {
  const now = new Date();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split("-").map(Number);
    const t = new Date(y, m - 1, d, 10, 0);
    if (t.getTime() > now.getTime() + 15 * 60_000) return toLocalInput(t.getTime());
  }
  const t = new Date(now);
  t.setMinutes(0, 0, 0);
  t.setHours(t.getHours() + 2);
  return toLocalInput(t.getTime());
}

export function Composer({ editId, duplicateId, date }: { editId?: string; duplicateId?: string; date?: string }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [targets, setTargets] = useState<Record<string, TargetState>>({});
  const [mode, setMode] = useState<Mode>("schedule");
  const [when, setWhen] = useState(() => defaultWhen(date));
  const [busy, setBusy] = useState<"" | "draft" | "submit">("");
  const [error, setError] = useState("");
  const [serverIssues, setServerIssues] = useState<Record<string, Issue[]>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!(editId || duplicateId));
  const [locked, setLocked] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState("");
  const dirty = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const touch = () => (dirty.current = true);

  useEffect(() => {
    api<{ accounts: AccountSummary[] }>("/api/accounts").then((r) => setAccounts(r.accounts)).catch((e) => setError(e.message));
    api<{ media: MediaItem[] }>("/api/media").then((r) => setLibrary(r.media)).catch(() => {});
  }, []);

  useEffect(() => {
    const src = editId || duplicateId;
    if (!src) return;
    api<{ post: Post }>(`/api/posts/${src}`)
      .then(({ post }) => {
        setCaption(post.caption);
        const gone = post.media.filter((m) => m.purged).length;
        setMedia(post.media.filter((m) => !m.purged));
        if (gone) setNotice(`${gone} media file${gone > 1 ? "s were" : " was"} deleted after publishing. Upload ${gone > 1 ? "them" : "it"} again if you want ${gone > 1 ? "them" : "it"} in this post.`);
        setTargets(Object.fromEntries(post.targets.filter((t) => t.account).map((t) => [t.accountId, { contentType: t.contentType, options: t.options, touched: true }])));
        if (editId) {
          if (!post.editable) setLocked(true);
          if (post.scheduledAt && post.scheduledAt > Date.now()) setWhen(toLocalInput(post.scheduledAt));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [editId, duplicateId]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const addToLibrary = useCallback((m: MediaItem) => setLibrary((l) => (l.some((x) => x.id === m.id) ? l : [m, ...l])), []);
  const onUploaded = useCallback(
    (m: MediaItem) => {
      addToLibrary(m);
      setMedia((ms) => [...ms, m]);
      touch();
    },
    [addToLibrary],
  );
  const { jobs, upload, dismiss } = useUploader(onUploaded);

  // Re-infer content types the user hasn't explicitly chosen when media changes.
  useEffect(() => {
    if (!accounts) return;
    setTargets((ts) => {
      let changed = false;
      const next = { ...ts };
      for (const [id, t] of Object.entries(ts)) {
        const a = accounts.find((x) => x.id === id);
        if (!a || t.touched) continue;
        const ct = inferType(a.platform, media);
        if (ct !== t.contentType) {
          next[id] = { ...t, contentType: ct, options: { ...defaultOptions(ct), ...t.options } };
          changed = true;
        }
      }
      return changed ? next : ts;
    });
  }, [media, accounts]);

  const lookup = useCallback((id: string) => library.find((m) => m.id === id) ?? media.find((m) => m.id === id), [library, media]);
  const scheduledAt = mode === "now" ? Date.now() : fromLocalInput(when);

  const issues = useMemo(() => {
    const out: Record<string, Issue[]> = {};
    for (const [id, t] of Object.entries(targets)) {
      out[id] = validateTarget({ contentType: t.contentType, options: t.options, caption, media, lookup, scheduledAt, mode });
    }
    return out;
  }, [targets, caption, media, lookup, scheduledAt, mode]);

  const errorCount = Object.values(issues).flat().filter((i) => i.level === "error").length;
  const selected = (accounts ?? []).filter((a) => targets[a.id]);

  const toggleAccount = (a: AccountSummary) => {
    touch();
    setTargets((ts) => {
      if (ts[a.id]) {
        const { [a.id]: _, ...rest } = ts;
        return rest;
      }
      const ct = inferType(a.platform, media);
      // Reuse settings from another account on the same platform for convenience.
      const sibling = Object.entries(ts).find(([id]) => accounts?.find((x) => x.id === id)?.platform === a.platform)?.[1];
      return { ...ts, [a.id]: sibling ? { ...sibling, options: { ...sibling.options, playlistId: undefined } } : { contentType: ct, options: defaultOptions(ct), touched: false } };
    });
  };

  const setTarget = (id: string, patch: Partial<TargetState>) => {
    touch();
    setServerIssues({});
    setTargets((ts) => ({ ...ts, [id]: { ...ts[id], ...patch } }));
  };
  const setOpt = (id: string, patch: Partial<TargetOptions>) => setTarget(id, { options: { ...targets[id].options, ...patch } });

  const moveMedia = (i: number, d: -1 | 1) => {
    touch();
    setMedia((ms) => {
      const j = i + d;
      if (j < 0 || j >= ms.length) return ms;
      const n = [...ms];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };

  const submit = async (asDraft: boolean) => {
    setBusy(asDraft ? "draft" : "submit");
    setError("");
    setServerIssues({});
    const body: PostInput = {
      caption,
      mediaIds: media.map((m) => m.id),
      mode: asDraft ? "draft" : mode,
      scheduledAt: asDraft ? fromLocalInput(when) : mode === "schedule" ? fromLocalInput(when) : null,
      targets: Object.entries(targets).map(([accountId, t]) => ({ accountId, contentType: t.contentType, options: t.options })),
    };
    try {
      const r = await api<{ post: Post }>(editId ? `/api/posts/${editId}` : "/api/posts", { method: editId ? "PUT" : "POST", json: body });
      dirty.current = false;
      router.push(`/posts/${r.post.id}`);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ClientError && e.details?.issues) setServerIssues(e.details.issues);
      setBusy("");
    }
  };

  if (locked) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit post" />
        <Banner>This post has started publishing, so it can&apos;t be edited. <Link className="text-accent" href={`/compose?duplicate=${editId}`}>Duplicate it</Link> instead.</Banner>
      </div>
    );
  }

  const previewTargetId = previewKey && targets[previewKey] ? previewKey : selected[0]?.id;
  const previewAccount = selected.find((a) => a.id === previewTargetId);
  const preview = previewAccount && (
    <div>
      {selected.length > 1 && (
        <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
          {selected.map((a) => (
            <button key={a.id} onClick={() => setPreviewKey(a.id)} className={`chip h-8 px-2 ${a.id === previewTargetId ? "bg-ink text-bg" : "bg-surface-2"}`}>
              <AccountAvatar account={a} size={18} /> {CONTENT_TYPES[targets[a.id].contentType].label}
            </button>
          ))}
        </div>
      )}
      <TargetPreview
        key={`${previewAccount.id}-${targets[previewAccount.id].contentType}`}
        contentType={targets[previewAccount.id].contentType}
        account={previewAccount}
        options={targets[previewAccount.id].options}
        caption={caption}
        media={media}
        lookup={lookup}
        scheduledAt={scheduledAt}
      />
    </div>
  );

  if (loading || accounts === null) return <div className="flex justify-center py-10 text-muted"><Spinner size={20} /></div>;

  return (
    <div>
      <PageHeader
        title={editId ? "Edit post" : "New post"}
        actions={selected.length > 0 && (
          <button className="btn-ghost btn-sm lg:hidden" onClick={() => setPreviewOpen(true)}>
            <IconEye size={14} /> Preview
          </button>
        )}
      />
      {notice && <div className="mb-4"><Banner>{notice}</Banner></div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5 min-w-0">
          {/* Accounts */}
          <section className="card p-4">
            <h2 className="text-sm font-semibold mb-3">Post to</h2>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted">No accounts connected. <Link href="/accounts" className="text-accent">Connect Instagram or YouTube</Link>.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => {
                  const on = !!targets[a.id];
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggleAccount(a)}
                      aria-pressed={on}
                      className={`flex items-center gap-2 rounded-full pl-1 pr-3 h-10 border text-sm transition ${on ? "border-accent bg-accent/8" : "border-line hover:bg-surface-2"} ${a.status !== "ok" ? "opacity-60" : ""}`}
                    >
                      <AccountAvatar account={a} size={30} />
                      <span className="max-w-36 truncate">{a.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {selected.some((a) => a.status !== "ok") && <p className="text-xs text-bad mt-2">A selected account needs reconnecting before it can publish.</p>}
          </section>

          {/* Media */}
          <section
            className={`card p-4 ${dragOver ? "ring-2 ring-accent" : ""}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Media {media.length > 0 && <span className="text-muted font-normal">· {media.length}</span>}</h2>
              <div className="flex gap-2">
                <button className="btn-ghost btn-sm" onClick={() => setPickerOpen(true)}><IconImage size={14} /> Library</button>
                <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><IconUpload size={14} /> Upload</button>
                <input ref={fileRef} type="file" hidden multiple accept="image/*,video/*" onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
              </div>
            </div>
            {media.length === 0 && jobs.length === 0 ? (
              <button onClick={() => fileRef.current?.click()} className="w-full rounded-xl border-2 border-dashed border-line py-8 text-sm text-muted hover:bg-surface-2">
                Tap to add photos or videos<span className="hidden md:inline">, or drop files here</span>
              </button>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {media.map((m, i) => (
                  <div key={`${m.id}-${i}`} className="relative shrink-0 w-28">
                    <MediaThumb media={m} className="w-28 h-28 rounded-xl" />
                    <span className="absolute top-1 left-1 chip h-5 px-1.5 bg-black/60 text-white">{i + 1}</span>
                    <button onClick={() => { touch(); setMedia((ms) => ms.filter((_, j) => j !== i)); }} className="absolute top-1 right-1 grid place-items-center w-6 h-6 rounded-full bg-black/60 text-white" aria-label="Remove">
                      <IconX size={14} />
                    </button>
                    <div className="flex justify-between items-center mt-1 text-[11px] text-muted">
                      <button disabled={i === 0} onClick={() => moveMedia(i, -1)} className="p-1 disabled:opacity-30" aria-label="Move left"><IconChevron size={14} className="rotate-180" /></button>
                      <span className="truncate">{m.width && m.height ? `${m.width}×${m.height}` : fmtBytes(m.size)}{m.kind === "video" && m.duration ? ` · ${fmtDuration(m.duration)}` : ""}</span>
                      <button disabled={i === media.length - 1} onClick={() => moveMedia(i, 1)} className="p-1 disabled:opacity-30" aria-label="Move right"><IconChevron size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2"><UploadJobs jobs={jobs} dismiss={dismiss} /></div>
          </section>

          {/* Caption */}
          <section className="card p-4">
            <label htmlFor="caption" className="text-sm font-semibold block mb-3">Caption</label>
            <textarea
              id="caption"
              className="input min-h-32"
              placeholder="Write a caption… (used as the YouTube description unless you override it)"
              value={caption}
              onChange={(e) => { touch(); setCaption(e.target.value); }}
            />
            <div className="flex justify-end gap-3 text-xs text-muted mt-1.5">
              <span className={countHashtags(caption) > 30 ? "text-bad" : ""}>#{countHashtags(caption)}/30</span>
              <span className={caption.length > 2200 ? "text-bad" : ""}>{caption.length}/2200</span>
            </div>
          </section>

          {/* Per-destination settings */}
          {selected.map((a) => (
            <TargetPanel
              key={a.id}
              account={a}
              state={targets[a.id]}
              issues={[...(issues[a.id] ?? []), ...(serverIssues[a.id] ?? []).filter((s) => !(issues[a.id] ?? []).some((i) => i.message === s.message))]}
              library={library}
              addToLibrary={addToLibrary}
              lookup={lookup}
              scheduledAt={scheduledAt}
              onType={(ct) => setTarget(a.id, { contentType: ct, touched: true, options: { ...defaultOptions(ct), ...targets[a.id].options } })}
              onOpt={(p) => setOpt(a.id, p)}
            />
          ))}

          {/* Schedule */}
          <section className="card p-4">
            <h2 className="text-sm font-semibold mb-3">When</h2>
            <div className="seg mb-3">
              <button aria-pressed={mode === "schedule"} onClick={() => setMode("schedule")}>Schedule</button>
              <button aria-pressed={mode === "now"} onClick={() => setMode("now")}>Publish now</button>
            </div>
            {mode === "schedule" && (
              <div>
                <input type="datetime-local" className="input max-w-72" value={when} onChange={(e) => { touch(); setWhen(e.target.value); }} />
                <p className="text-xs text-muted mt-1.5">{timeZoneName()}</p>
              </div>
            )}
          </section>

          {error && <Banner tone="error">{error}</Banner>}

          <div className="sticky bottom-20 md:bottom-4 z-30 card p-3 flex items-center gap-2 shadow-lg">
            <span className="text-xs text-muted flex-1 min-w-0 truncate">
              {selected.length === 0 ? "Pick at least one account" : errorCount ? <span className="text-bad">{errorCount} issue{errorCount > 1 ? "s" : ""} to fix</span> : "Ready"}
            </span>
            <button className="btn-ghost" disabled={!!busy} onClick={() => submit(true)}>
              {busy === "draft" && <Spinner />} Save draft
            </button>
            <button className="btn-primary" disabled={!!busy || selected.length === 0 || errorCount > 0} onClick={() => submit(false)}>
              {busy === "submit" && <Spinner />} {mode === "now" ? "Publish" : "Schedule"}
            </button>
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-8">
            <h2 className="text-sm font-semibold mb-3">Preview</h2>
            {preview ?? <p className="text-sm text-muted">Select an account to preview.</p>}
          </div>
        </aside>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        library={library}
        onLibraryAdd={addToLibrary}
        multiple
        initial={media.map((m) => m.id)}
        onDone={(ids) => { touch(); setMedia(ids.map((id) => lookup(id)!).filter(Boolean)); }}
      />
      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview">{preview}</Sheet>
    </div>
  );
}

function TargetPanel({
  account: a,
  state,
  issues,
  library,
  addToLibrary,
  lookup,
  scheduledAt,
  onType,
  onOpt,
}: {
  account: AccountSummary;
  state: TargetState;
  issues: Issue[];
  library: MediaItem[];
  addToLibrary: (m: MediaItem) => void;
  lookup: (id: string) => MediaItem | undefined;
  scheduledAt: number | null;
  onType: (ct: ContentType) => void;
  onOpt: (p: Partial<TargetOptions>) => void;
}) {
  const o = state.options;
  const ct = state.contentType;
  const [picker, setPicker] = useState<"" | "thumbnail" | "cover">("");
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[] | null>(null);
  const [plError, setPlError] = useState("");
  const [tagText, setTagText] = useState((o.tags ?? []).join(", "));
  const yt = a.platform === "youtube";

  useEffect(() => {
    if (!yt) return;
    api<{ playlists: { id: string; title: string }[] }>(`/api/accounts/${a.id}/playlists`)
      .then((r) => setPlaylists(r.playlists))
      .catch((e) => setPlError(e.message));
  }, [a.id, yt]);

  const thumb = o.thumbnailMediaId ? lookup(o.thumbnailMediaId) : undefined;
  const cover = o.coverMediaId ? lookup(o.coverMediaId) : undefined;
  const native = (ct === "yt_video" || ct === "yt_short") && scheduledAt != null && usesNativeSchedule(o, scheduledAt);

  return (
    <section className="card p-4">
      <div className="flex items-center gap-3 mb-3">
        <AccountAvatar account={a} size={32} />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{a.name}</p>
          <p className="text-xs text-muted">{CONTENT_TYPES[ct].hint}</p>
        </div>
      </div>
      <div className="seg mb-4 max-w-full overflow-x-auto no-scrollbar">
        {PLATFORM_TYPES[a.platform].map((t) => (
          <button key={t} aria-pressed={t === ct} onClick={() => onType(t)}>{CONTENT_TYPES[t].label}</button>
        ))}
      </div>

      <div className="space-y-4">
        {!yt && ct === "ig_reel" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={o.shareToFeed !== false} onChange={(e) => onOpt({ shareToFeed: e.target.checked })} />
              Also show in the main feed
            </label>
            <div>
              <span className="label">Cover</span>
              <div className="flex items-center gap-3">
                {cover ? (
                  <div className="relative">
                    <MediaThumb media={cover} className="w-14 h-24 rounded-lg" />
                    <button onClick={() => onOpt({ coverMediaId: undefined })} className="absolute -top-1.5 -right-1.5 w-5 h-5 grid place-items-center rounded-full bg-ink text-bg" aria-label="Remove cover"><IconX size={12} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted">Frame at</span>
                    <input type="number" min={0} step={0.5} className="input w-20 h-8" value={o.thumbOffsetSec ?? 0} onChange={(e) => onOpt({ thumbOffsetSec: Number(e.target.value) })} />
                    <span className="text-muted">s</span>
                  </div>
                )}
                <button className="btn-ghost btn-sm" onClick={() => setPicker("cover")}>{cover ? "Change" : "Custom image"}</button>
              </div>
            </div>
          </>
        )}
        {!yt && ct !== "ig_story" && (
          <div>
            <label className="label">First comment <span className="font-normal">(optional, posted right after)</span></label>
            <textarea className="input min-h-16" placeholder="e.g. hashtags" value={o.firstComment ?? ""} onChange={(e) => onOpt({ firstComment: e.target.value })} />
          </div>
        )}

        {yt && (
          <>
            <div>
              <label className="label">Title</label>
              <input className="input" maxLength={110} value={o.title ?? ""} onChange={(e) => onOpt({ title: e.target.value })} placeholder={ct === "yt_short" ? "Short title #Shorts" : "Video title"} />
              <p className={`text-xs mt-1 text-right ${(o.title ?? "").length > 100 ? "text-bad" : "text-muted"}`}>{(o.title ?? "").length}/100</p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm mb-2">
                <input type="checkbox" checked={o.useCaption !== false} onChange={(e) => onOpt({ useCaption: e.target.checked })} />
                Use caption as description
              </label>
              {o.useCaption === false && (
                <textarea className="input min-h-24" placeholder="Description" value={o.description ?? ""} onChange={(e) => onOpt({ description: e.target.value })} />
              )}
            </div>
            <div>
              <label className="label">Tags <span className="font-normal">(comma separated)</span></label>
              <input
                className="input"
                value={tagText}
                onChange={(e) => {
                  setTagText(e.target.value);
                  onOpt({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) });
                }}
                placeholder="tutorial, cooking, quick recipes"
              />
              <p className="text-xs text-muted mt-1 text-right">{tagsLength(o.tags ?? [])}/500</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Visibility</label>
                <select className="input" value={o.privacy ?? "public"} onChange={(e) => onOpt({ privacy: e.target.value as TargetOptions["privacy"] })}>
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                </select>
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={o.categoryId ?? "22"} onChange={(e) => onOpt({ categoryId: e.target.value })}>
                  {YT_CATEGORIES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <span className="label">Audience</span>
              <div className="seg">
                <button aria-pressed={!o.madeForKids} onClick={() => onOpt({ madeForKids: false })}>Not made for kids</button>
                <button aria-pressed={!!o.madeForKids} onClick={() => onOpt({ madeForKids: true })}>Made for kids</button>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={!!o.syntheticMedia} onChange={(e) => onOpt({ syntheticMedia: e.target.checked })} />
              <span>Contains realistic altered or synthetic content <span className="text-muted">(YouTube disclosure)</span></span>
            </label>
            <div>
              <label className="label">Playlist</label>
              {plError ? (
                <p className="text-xs text-bad">{plError}</p>
              ) : (
                <select className="input" value={o.playlistId ?? ""} onChange={(e) => onOpt({ playlistId: e.target.value || undefined })} disabled={!playlists}>
                  <option value="">None</option>
                  {playlists?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              )}
            </div>
            <div>
              <span className="label">Thumbnail</span>
              <div className="flex items-center gap-3">
                {thumb ? (
                  <div className="relative">
                    <MediaThumb media={thumb} className="w-28 aspect-video rounded-lg" />
                    <button onClick={() => onOpt({ thumbnailMediaId: undefined })} className="absolute -top-1.5 -right-1.5 w-5 h-5 grid place-items-center rounded-full bg-ink text-bg" aria-label="Remove thumbnail"><IconX size={12} /></button>
                  </div>
                ) : (
                  <span className="text-sm text-muted">Auto-generated</span>
                )}
                <button className="btn-ghost btn-sm" onClick={() => setPicker("thumbnail")}>{thumb ? "Change" : "Choose image"}</button>
              </div>
              {ct === "yt_short" && <p className="text-xs text-muted mt-1">YouTube may ignore custom thumbnails on Shorts.</p>}
            </div>
            {ct !== "yt_live" && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={o.notifySubscribers !== false} onChange={(e) => onOpt({ notifySubscribers: e.target.checked })} />
                  Notify subscribers
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={o.nativeSchedule !== false} onChange={(e) => onOpt({ nativeSchedule: e.target.checked })} />
                  <span>
                    Upload now, let YouTube publish on time
                    <span className="block text-xs text-muted">
                      {native ? "On: uploads immediately as private with a publish time. Safe even if this server goes offline." : "Applies to public posts scheduled 10+ minutes ahead."}
                    </span>
                  </span>
                </label>
              </>
            )}
            {ct === "yt_live" && <p className="text-xs text-muted">Creates the live event (with its watch page) right away. You still start the stream from YouTube Studio or your encoder. The channel must have live streaming enabled.</p>}
          </>
        )}

        {issues.length > 0 && (
          <ul className="space-y-1">
            {issues.map((i, n) => (
              <li key={n} className={`text-xs flex gap-1.5 ${i.level === "error" ? "text-bad" : "text-warn"}`}>
                <span>{i.level === "error" ? "●" : "▲"}</span>
                {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <MediaPicker
        open={!!picker}
        onClose={() => setPicker("")}
        library={library}
        onLibraryAdd={addToLibrary}
        kind="image"
        title={picker === "cover" ? "Reel cover" : "Thumbnail"}
        onDone={([id]) => onOpt(picker === "cover" ? { coverMediaId: id } : { thumbnailMediaId: id })}
      />
    </section>
  );
}
