"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { dayKey, fmtTime } from "@/lib/format";
import type { Post } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { IconChevron, IconPlus, PlatformIcon } from "./icons";
import { MediaThumb, Spinner, StatusBadge } from "./ui";
import { platformsOf, postLabel, targetLabel } from "./postUtil";

function firstDayOfWeek(): number {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const fd = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    if (fd) return fd % 7;
  } catch {}
  return 0;
}

function gridStart(month: Date, weekStart: number): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - offset);
}

function dotColor(p: Post) {
  if (p.status === "failed" || p.status === "partial") return "bg-bad";
  if (p.status === "published") return "bg-ok";
  if (p.status === "draft") return "bg-muted";
  return "bg-accent";
}

export function CalendarView() {
  const router = useRouter();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [weekStart, setWeekStart] = useState(0);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [selected, setSelected] = useState<string>(() => dayKey(Date.now()));
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => setWeekStart(firstDayOfWeek()), []);

  const days = useMemo(() => {
    const start = gridStart(month, weekStart);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month, weekStart]);

  const load = useCallback(async () => {
    const from = days[0].getTime();
    const to = new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate() + 1).getTime();
    try {
      const r = await api<{ posts: Post[] }>(`/api/posts?from=${from}&to=${to}`);
      setPosts(r.posts);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [days]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts ?? []) {
      if (p.scheduledAt == null) continue;
      const k = dayKey(p.scheduledAt);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return m;
  }, [posts]);

  const todayKey = dayKey(Date.now());
  const weekdays = days.slice(0, 7).map((d) => d.toLocaleDateString(undefined, { weekday: "short" }));
  const selectedDate = days.find((d) => dayKey(d.getTime()) === selected);
  const selectedPosts = byDay.get(selected) ?? [];

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const composeOn = (d: Date) => {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    router.push(`/compose?date=${iso}`);
  };

  const drop = async (d: Date) => {
    const p = posts?.find((x) => x.id === dragId);
    setDragId(null);
    if (!p || p.scheduledAt == null) return;
    const old = new Date(p.scheduledAt);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), old.getHours(), old.getMinutes()).getTime();
    if (next === p.scheduledAt) return;
    setPosts((ps) => ps?.map((x) => (x.id === p.id ? { ...x, scheduledAt: next } : x)) ?? null);
    try {
      await api(`/api/posts/${p.id}`, { method: "PATCH", json: { scheduledAt: next } });
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };

  return (
    <div>
      <PageHeader
        title={month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        actions={
          <>
            <button className="btn-ghost btn-sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(dayKey(d.getTime())); }}>
              Today
            </button>
            <button className="btn-ghost btn-sm px-2" onClick={() => shift(-1)} aria-label="Previous month">
              <IconChevron size={16} className="rotate-180" />
            </button>
            <button className="btn-ghost btn-sm px-2" onClick={() => shift(1)} aria-label="Next month">
              <IconChevron size={16} />
            </button>
          </>
        }
      />
      {error && (
        <p className="text-sm text-bad mb-3" onClick={() => setError("")}>
          {error}
        </p>
      )}

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line text-[11px] md:text-xs text-muted">
          {weekdays.map((w) => (
            <div key={w} className="px-2 py-2 text-center md:text-left">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const k = dayKey(d.getTime());
            const inMonth = d.getMonth() === month.getMonth();
            const list = byDay.get(k) ?? [];
            const isPast = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() <= Date.now();
            return (
              <div
                key={k}
                onClick={() => setSelected(k)}
                onDragOver={(e) => dragId && !isPast && e.preventDefault()}
                onDrop={() => drop(d)}
                className={`group relative min-h-14 md:min-h-28 p-1 md:p-1.5 border-line ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-surface-2/50"} ${selected === k ? "max-md:bg-accent/8" : ""} cursor-pointer md:cursor-default`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`grid place-items-center w-6 h-6 md:w-7 md:h-7 rounded-full text-xs md:text-sm mx-auto md:mx-0 ${k === todayKey ? "bg-accent text-accent-ink font-semibold" : inMonth ? "" : "text-muted"}`}
                  >
                    {d.getDate()}
                  </span>
                  {!isPast && (
                    <button
                      onClick={(e) => { e.stopPropagation(); composeOn(d); }}
                      className="hidden md:grid place-items-center w-6 h-6 rounded-lg text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-ink"
                      aria-label="New post on this day"
                    >
                      <IconPlus size={14} />
                    </button>
                  )}
                </div>
                {/* phone: dots */}
                <div className="md:hidden flex flex-wrap justify-center gap-0.5 mt-1">
                  {list.slice(0, 4).map((p) => <span key={p.id} className={`w-1.5 h-1.5 rounded-full ${dotColor(p)}`} />)}
                </div>
                {/* desktop: chips */}
                <div className="hidden md:flex flex-col gap-1 mt-1">
                  {list.slice(0, 3).map((p) => (
                    <Link
                      key={p.id}
                      href={`/posts/${p.id}`}
                      draggable={p.editable && p.status === "scheduled"}
                      onDragStart={() => setDragId(p.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 rounded-lg bg-surface-2 hover:bg-line px-1.5 py-1 text-xs"
                      title={postLabel(p)}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor(p)}`} />
                      <span className="text-muted tabular-nums shrink-0">{fmtTime(p.scheduledAt!)}</span>
                      <span className="truncate">{postLabel(p)}</span>
                      <span className="ml-auto flex -space-x-1 shrink-0">
                        {platformsOf(p).map((pl) => <PlatformIcon key={pl} platform={pl} size={13} />)}
                      </span>
                    </Link>
                  ))}
                  {list.length > 3 && (
                    <button className="text-[11px] text-muted text-left px-1.5" onClick={() => setSelected(k)}>
                      +{list.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day agenda: always on phones, on desktop when a day is clicked */}
      <section className="mt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">
            {selectedDate?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) ?? "Selected day"}
          </h2>
          {selectedDate && new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1).getTime() > Date.now() && (
            <button className="btn-ghost btn-sm" onClick={() => composeOn(selectedDate)}>
              <IconPlus size={14} /> Add
            </button>
          )}
        </div>
        {posts === null ? (
          <div className="text-muted flex justify-center py-6"><Spinner /></div>
        ) : selectedPosts.length === 0 ? (
          <p className="text-sm text-muted">Nothing scheduled.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {selectedPosts.map((p) => <PostRow key={p.id} post={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}

export function PostRow({ post: p, showDate = false }: { post: Post; showDate?: boolean }) {
  return (
    <Link href={`/posts/${p.id}`} className="card flex gap-3 p-3 min-w-0 hover:border-muted/40 transition">
      {p.media[0] ? (
        <MediaThumb media={p.media[0]} className="w-16 h-16 rounded-xl shrink-0" showMeta={false} />
      ) : (
        <div className="w-16 h-16 rounded-xl bg-surface-2 shrink-0 grid place-items-center text-muted text-xs">Text</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted">
          {p.scheduledAt != null ? (showDate ? new Date(p.scheduledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : fmtTime(p.scheduledAt)) : "No date"}
          <span className="flex -space-x-1">
            {platformsOf(p).map((pl) => <PlatformIcon key={pl} platform={pl} size={14} />)}
          </span>
        </div>
        <p className="text-sm font-medium truncate mt-0.5">{postLabel(p)}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <StatusBadge status={p.status} />
          {p.targets.map((t) => (
            <span key={t.id} className="chip bg-surface-2 text-muted">
              {t.account?.name ?? "Removed account"} · {targetLabel(t)}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
