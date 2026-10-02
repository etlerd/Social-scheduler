"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, fmtTime } from "@/lib/format";
import type { Post } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { IconExternal } from "./icons";
import { AccountAvatar, Banner, MediaThumb, Spinner, StatusBadge } from "./ui";
import { effectiveTargetStatus, postLabel, targetLabel } from "./postUtil";

export function PostDetail({ id }: { id: string }) {
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    const t = setInterval(load, active ? 3000 : 20000);
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
          {hasFailed && (
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act(async () => { setPost((await api<{ post: Post }>(`/api/posts/${id}/retry`, { method: "POST" })).post); })}>
              Retry failed
            </button>
          )}
          <Link href={`/compose?duplicate=${post.id}`} className="btn-ghost btn-sm">Duplicate</Link>
          <button
            className="btn-danger btn-sm"
            disabled={busy}
            onClick={() => {
              const msg = anyLive
                ? "Remove this post from the scheduler? It stays live on Instagram/YouTube; delete it there separately."
                : "Delete this post? This can't be undone.";
              if (confirm(msg)) act(async () => { await api(`/api/posts/${id}`, { method: "DELETE" }); router.replace("/posts"); });
            }}
          >
            Delete
          </button>
        </div>
      </div>
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
              {t.status === "failed" && t.error && <p className="text-sm text-bad mt-3">{t.error}</p>}
              {t.externalUrl && (
                <a href={t.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent mt-3">
                  Open on {t.contentType.startsWith("ig_") ? "Instagram" : "YouTube"} <IconExternal size={14} />
                </a>
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
