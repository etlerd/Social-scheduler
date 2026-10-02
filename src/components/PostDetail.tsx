"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, fmtTime, fromLocalInput, toLocalInput } from "@/lib/format";
import type { Post } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { IconExternal } from "./icons";
import { AccountAvatar, Banner, MediaThumb, Spinner, StatusBadge } from "./ui";
import { deleteWithUndo, toast } from "./toast";
import { quickTimes } from "./Composer";
import { TargetPreview } from "./Previews";
import { effectiveTargetStatus, postLabel, targetLabel } from "./postUtil";

export function PostDetail({ id }: { id: string }) {
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  useEffect(() => {
    if (moving && post?.scheduledAt) setMoveTo(toLocalInput(Math.max(post.scheduledAt, Date.now() + 3600_000)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving]);

  const load = useCallback(async () => {
    try {
      setPost((await api<{ post: Post }>(`/api/posts/${id}`)).post);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!post) return;
    const active = post.targets.some((t) => t.status === "publishing" || (t.status === "scheduled" && (t.dispatchAt ?? Infinity) < Date.now() + 60_000));
    const t = setInterval(() => !document.hidden && load(), active ? 3000 : 20000);
    return () => clearInterval(t);
  }, [post, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!post) {
    return error ? <Banner tone="error">{error}</Banner> : <div className="flex justify-center py-10 text-muted"><Spinner size={20} /></div>;
  }

  const hasFailed = post.targets.some((t) => t.status === "failed");
  const anyLive = post.targets.some((t) => ["published", "platform_scheduled"].includes(t.status));

  return (
    <div className="max-w-3xl">
      <PageHeader title={postLabel(post)} />
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <StatusBadge status={post.status} />
        <span className="text-sm text-muted">{post.scheduledAt ? fmtDateTime(post.scheduledAt) : "Not scheduled"}</span>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:ml-auto">
          {post.editable && <Link href={`/compose?id=${post.id}`} className="btn-primary btn-sm">Edit</Link>}
          {post.editable && post.targets.some((t) => t.status === "scheduled") && (
            <button className="btn-ghost btn-sm" onClick={() => setMoving((v) => !v)} aria-expanded={moving}>Move</button>
          )}
          {hasFailed && (
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act(async () => { setPost((await api<{ post: Post }>(`/api/posts/${id}/retry`, { method: "POST" })).post); toast("Retrying now"); })}>
              Retry failed
            </button>
          )}
          <Link href={`/compose?duplicate=${post.id}`} className="btn-ghost btn-sm">Duplicate</Link>
          <button
            className="btn-danger btn-sm"
            disabled={busy || post.targets.some((t) => t.status === "publishing")}
            title={post.targets.some((t) => t.status === "publishing") ? "Wait until publishing finishes" : undefined}
            onClick={() => {
              deleteWithUndo(
                id,
                anyLive ? "Removed from the scheduler. It stays live on Instagram/YouTube." : "Post deleted",
                async () => { await api(`/api/posts/${id}`, { method: "DELETE" }); },
                (e) => toast(`Couldn't delete: ${e.message}`),
              );
              router.replace("/posts");
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {moving && (
        <div className="card p-4 mb-5">
          <p className="text-sm font-medium mb-2.5">Move to</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {quickTimes().map((q) => (
              <button key={q.label} className={`chip h-8 px-3 border ${fromLocalInput(moveTo) === q.ms ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface hover:bg-surface-2"}`} onClick={() => setMoveTo(toLocalInput(q.ms))}>
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="datetime-local" className="input max-w-64" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
            <button
              className="btn-primary btn-sm"
              disabled={busy || fromLocalInput(moveTo) == null}
              onClick={() => act(async () => {
                const r = await api<{ post: Post }>(`/api/posts/${id}`, { method: "PATCH", json: { scheduledAt: fromLocalInput(moveTo) } });
                setPost((p) => (p ? { ...p, ...r.post, targets: r.post.targets.map((t) => ({ ...t, events: p.targets.find((x) => x.id === t.id)?.events })) } : r.post));
                setMoving(false);
                toast(`Moved to ${fmtDateTime(r.post.scheduledAt!)}`);
              })}
            >
              Save
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setMoving(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="mb-4"><Banner tone="error">{error}</Banner></div>}

      {post.media.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-5">
          {post.media.map((m) => <MediaThumb key={m.id} media={m} className="w-28 h-28 rounded-xl shrink-0" />)}
        </div>
      )}
      {post.caption && <p className="card p-4 text-sm whitespace-pre-wrap mb-5">{post.caption}</p>}

      <h2 className="font-semibold mb-3">Destinations</h2>
      <div className="space-y-3">
        {post.targets.map((t) => {
          const st = effectiveTargetStatus(t, post.scheduledAt);
          return (
            <div key={t.id} className="card p-4">
              <div className="flex items-center gap-3">
                {t.account ? <AccountAvatar account={t.account} size={36} /> : <span className="w-9 h-9 rounded-full bg-surface-2" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{t.account?.name ?? "Removed account"}</p>
                  <p className="text-xs text-muted">{targetLabel(t)}{t.account?.mode === "demo" ? " · demo" : ""}</p>
                </div>
                <StatusBadge status={st} />
              </div>
              {t.contentType.startsWith("yt_") && t.options.title && <p className="text-sm mt-3"><span className="text-muted">Title:</span> {t.options.title}</p>}
              {t.status === "platform_scheduled" && st === "platform_scheduled" && (
                <p className="text-xs text-muted mt-3">
                  {t.contentType === "yt_live" ? "Live event created on YouTube." : "Uploaded; YouTube publishes it at the scheduled time."} This server doesn&apos;t need to be online.
                </p>
              )}
              {t.status === "scheduled" && t.dispatchAt && t.error && (
                <p className="text-xs text-warn mt-3">Retrying at {fmtTime(t.dispatchAt)}: {t.error}</p>
              )}
              {t.status === "failed" && t.error && (
                <div className="mt-3 rounded-xl bg-bad/8 px-3 py-2.5">
                  <p className="text-sm text-bad">{t.error}</p>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {t.account?.status === "reconnect" && t.account.mode === "live" && (
                      <a href={`/api/oauth/${t.account.platform}/start`} className="btn-primary btn-sm">Reconnect {t.account.platform === "instagram" ? "Instagram" : "YouTube"}</a>
                    )}
                    <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act(async () => { setPost((await api<{ post: Post }>(`/api/posts/${id}/retry`, { method: "POST" })).post); toast("Retrying now"); })}>
                      Retry
                    </button>
                    {post.editable && <Link href={`/compose?id=${post.id}`} className="btn-ghost btn-sm">Edit, then retry</Link>}
                  </div>
                </div>
              )}
              {t.externalUrl && (
                <a href={t.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent mt-3">
                  Open on {t.contentType.startsWith("ig_") ? "Instagram" : "YouTube"} <IconExternal size={14} />
                </a>
              )}
              {t.account && (
                <details className="mt-3 group">
                  <summary className="text-xs text-muted cursor-pointer">Preview</summary>
                  <div className="mt-3 max-w-sm">
                    <TargetPreview
                      contentType={t.contentType}
                      account={t.account}
                      options={t.options}
                      caption={post.caption}
                      media={post.media}
                      lookup={(mid) => post.media.find((m) => m.id === mid)}
                      scheduledAt={post.scheduledAt}
                    />
                  </div>
                </details>
              )}
              {t.events && t.events.length > 0 && (
                <details className="mt-3">
                  <summary className="text-xs text-muted cursor-pointer">Activity ({t.events.length})</summary>
                  <ol className="mt-2 space-y-1 text-xs">
                    {t.events.map((e, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-muted tabular-nums shrink-0">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                        <span className={e.level === "error" ? "text-bad" : e.level === "warn" ? "text-warn" : ""}>{e.message}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
