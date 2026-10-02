"use client";

import { useState } from "react";
import { captionFor, mediaForTarget, ytDescription } from "@/lib/rules";
import type { AccountSummary, ContentType, MediaItem, TargetOptions } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { AccountAvatar } from "./ui";

function Visual({ m, fit = "cover" }: { m?: MediaItem; fit?: "cover" | "contain" }) {
  if (!m) return <div className="w-full h-full grid place-items-center text-xs text-white/60">No media</div>;
  const cls = `w-full h-full ${fit === "cover" ? "object-cover" : "object-contain"}`;
  return m.kind === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.url} alt="" className={cls} />
  ) : (
    <video src={m.url} className={cls} muted loop playsInline autoPlay preload="metadata" />
  );
}

function Caption({ name, text }: { name: string; text: string }) {
  const [more, setMore] = useState(false);
  if (!text) return null;
  const long = text.length > 120;
  return (
    <p className="text-[13px] leading-snug whitespace-pre-wrap break-words">
      <span className="font-semibold mr-1">{name}</span>
      {more || !long ? text : text.slice(0, 120)}
      {long && !more && <button className="text-muted ml-1" onClick={() => setMore(true)}>… more</button>}
    </p>
  );
}

interface Props {
  contentType: ContentType;
  account: AccountSummary;
  options: TargetOptions;
  caption: string;
  media: MediaItem[];
  lookup: (id: string) => MediaItem | undefined;
  scheduledAt: number | null;
}

export function TargetPreview(props: Props) {
  const p = { ...props, caption: props.contentType.startsWith("ig_") ? captionFor(props.caption, props.options) : props.caption };
  const used = mediaForTarget(p.contentType, p.media);
  const handle = p.account.username?.replace(/^@/, "") || p.account.name;
  const [idx, setIdx] = useState(0);

  switch (p.contentType) {
    case "ig_image":
    case "ig_carousel": {
      const first = used[0];
      const r = first?.width && first?.height ? Math.min(1.91, Math.max(0.8, first.width / first.height)) : 1;
      const cur = used[Math.min(idx, used.length - 1)];
      return (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden text-ink">
          <div className="flex items-center gap-2 px-3 h-12">
            <AccountAvatar account={p.account} size={28} />
            <span className="text-[13px] font-semibold">{handle}</span>
          </div>
          <div className="relative bg-black" style={{ aspectRatio: String(r) }}>
            <Visual m={cur} />
            {used.length > 1 && (
              <>
                <span className="absolute top-2 right-2 chip bg-black/60 text-white">{idx + 1}/{used.length}</span>
                {idx > 0 && <button onClick={() => setIdx(idx - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 text-black" aria-label="Previous">‹</button>}
                {idx < used.length - 1 && <button onClick={() => setIdx(idx + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 text-black" aria-label="Next">›</button>}
              </>
            )}
          </div>
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="flex gap-3.5 text-lg leading-none">
              <span>♡</span><span>💬</span><span>➤</span>
              {used.length > 1 && (
                <span className="flex-1 flex justify-center gap-1 items-center">
                  {used.map((_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === idx ? "bg-accent" : "bg-line"}`} />)}
                </span>
              )}
            </div>
            <Caption name={handle} text={p.caption} />
            {p.options.firstComment && <p className="text-[13px] text-muted"><span className="font-semibold text-ink mr-1">{handle}</span>{p.options.firstComment}</p>}
          </div>
        </div>
      );
    }
    case "ig_reel":
    case "ig_story":
    case "yt_short": {
      const story = p.contentType === "ig_story";
      const short = p.contentType === "yt_short";
      return (
        <div className="relative mx-auto w-full max-w-[280px] aspect-[9/16] rounded-[28px] overflow-hidden bg-black text-white">
          <Visual m={used[0]} />
          {story && (
            <div className="absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-black/50 to-transparent">
              <div className="h-0.5 rounded bg-white/40 mb-2.5"><div className="h-full w-1/3 bg-white rounded" /></div>
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <AccountAvatar account={p.account} size={24} /> {handle}
              </div>
            </div>
          )}
          {!story && (
            <div className="absolute bottom-0 inset-x-0 p-3 pt-10 bg-gradient-to-t from-black/70 to-transparent space-y-2">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <AccountAvatar account={p.account} size={24} /> {short ? `@${handle.replace(/^@/, "")}` : handle}
                {short && <span className="chip bg-white text-black h-5">Subscribe</span>}
              </div>
              <p className="text-[13px] leading-snug line-clamp-2">{short ? p.options.title : p.caption}</p>
            </div>
          )}
          <span className="absolute top-3 right-3 chip bg-black/50 text-white">{story ? "Story" : short ? "Shorts" : "Reel"}</span>
        </div>
      );
    }
    case "yt_video":
    case "yt_live": {
      const live = p.contentType === "yt_live";
      const thumb = p.options.thumbnailMediaId ? p.lookup(p.options.thumbnailMediaId) : undefined;
      const desc = ytDescription(p.caption, p.options);
      return (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden">
          <div className="relative aspect-video bg-black">
            {live ? (
              thumb ? <Visual m={thumb} /> : <div className="w-full h-full grid place-items-center text-white/70 text-sm">Live stream</div>
            ) : thumb ? (
              <Visual m={thumb} />
            ) : (
              <Visual m={used[0]} fit="contain" />
            )}
            {live && (
              <span className="absolute left-2 bottom-2 chip bg-black/75 text-white">
                Scheduled · {p.scheduledAt ? fmtDateTime(p.scheduledAt) : "pick a time"}
              </span>
            )}
          </div>
          <div className="p-3 flex gap-3">
            <AccountAvatar account={p.account} size={36} />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-snug line-clamp-2">{p.options.title || <span className="text-muted">Untitled</span>}</p>
              <p className="text-xs text-muted mt-0.5">{p.account.name} · {p.options.privacy ?? "public"}</p>
              {desc && <p className="text-xs text-muted mt-2 line-clamp-3 whitespace-pre-wrap">{desc}</p>}
            </div>
          </div>
        </div>
      );
    }
  }
}
