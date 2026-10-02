"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import type { Post } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { PostRow } from "./CalendarView";
import { IconPlus } from "./icons";
import { Empty, Spinner } from "./ui";

const TABS = [
  { key: "upcoming", label: "Upcoming", match: (p: Post) => p.status === "scheduled" || p.status === "publishing" },
  { key: "drafts", label: "Drafts", match: (p: Post) => p.status === "draft" },
  { key: "published", label: "Published", match: (p: Post) => p.status === "published" },
  { key: "failed", label: "Needs attention", match: (p: Post) => p.status === "failed" || p.status === "partial" },
  { key: "all", label: "All", match: () => true },
] as const;

export function PostsView() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const params = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(() => {
    const t = params.get("tab");
    return TABS.some((x) => x.key === t) ? (t as (typeof TABS)[number]["key"]) : "upcoming";
  });
  const [q, setQ] = useState("");

  useEffect(() => {
    const load = () => api<{ posts: Post[] }>("/api/posts").then((r) => setPosts(r.posts)).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, (posts ?? []).filter(t.match).length])), [posts]);

  const shown = useMemo(() => {
    const t = TABS.find((x) => x.key === tab)!;
    const needle = q.trim().toLowerCase();
    const list = (posts ?? []).filter(t.match).filter((p) =>
      !needle || p.caption.toLowerCase().includes(needle) || p.targets.some((x) => (x.options.title || "").toLowerCase().includes(needle)),
    );
    const key = (p: Post) => p.scheduledAt ?? p.updatedAt;
    return tab === "upcoming" ? list.sort((a, b) => key(a) - key(b)) : list.sort((a, b) => key(b) - key(a));
  }, [posts, tab, q]);

  return (
    <div>
      <PageHeader title="Posts" actions={<Link href="/compose" className="btn-primary btn-sm md:h-10 md:px-4 md:text-sm"><IconPlus size={16} /> New</Link>} />
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div className="seg overflow-x-auto no-scrollbar max-w-full">
          {TABS.map((t) => (
            <button key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)} className="whitespace-nowrap">
              {t.label}
              {posts && counts[t.key] > 0 && <span className={`ml-1.5 text-xs ${t.key === "failed" ? "text-bad" : "text-muted"}`}>{counts[t.key]}</span>}
            </button>
          ))}
        </div>
        <input className="input md:max-w-64 md:ml-auto" placeholder="Search captions & titles" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {posts === null ? (
        <div className="flex justify-center py-10 text-muted"><Spinner size={20} /></div>
      ) : shown.length === 0 ? (
        <Empty title="Nothing here yet">
          <Link href="/compose" className="text-accent">Create a post</Link>
        </Empty>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {shown.map((p) => <PostRow key={p.id} post={p} showDate />)}
        </div>
      )}
    </div>
  );
}
