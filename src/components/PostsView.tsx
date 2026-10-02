"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import type { Post } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { PostRow } from "./CalendarView";
import { IconPlus } from "./icons";
import { Empty, Spinner } from "./ui";
import { isPendingDelete, onPendingDeletesChange } from "./toast";
import { usePolling } from "./usePolling";

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "drafts", label: "Drafts" },
  { key: "published", label: "Published" },
  { key: "failed", label: "Needs attention" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const PAGE = 50;

export function PostsView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get("tab");
    return TABS.some((x) => x.key === t) ? (t as Tab) : "upcoming";
  });
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<Tab, number> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [, bump] = useState(0);

  useEffect(() => onPendingDeletesChange(() => bump((n) => n + 1)), []);

  // Debounce typing so each keystroke doesn't hit the server.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const url = useCallback(
    (offset: number, limit: number) => `/api/posts?view=${tab}&offset=${offset}&limit=${limit}${search ? `&q=${encodeURIComponent(search)}` : ""}`,
    [tab, search],
  );

  // Switching tab or search resets the list.
  useEffect(() => setPosts(null), [tab, search]);

  // Refresh what's on screen (at least one page) plus the tab counts.
  usePolling(
    () => {
      api<{ posts: Post[]; total: number }>(url(0, Math.max(PAGE, posts?.length ?? 0)))
        .then((r) => {
          setPosts(r.posts);
          setTotal(r.total);
        })
        .catch(() => {});
      api<{ counts: Record<Tab, number> }>("/api/overview").then((r) => setCounts(r.counts)).catch(() => {});
    },
    20000,
    [url],
  );

  const loadMore = async () => {
    if (!posts) return;
    setLoadingMore(true);
    try {
      const r = await api<{ posts: Post[]; total: number }>(url(posts.length, PAGE));
      setPosts([...posts, ...r.posts.filter((p) => !posts.some((x) => x.id === p.id))]);
      setTotal(r.total);
    } finally {
      setLoadingMore(false);
    }
  };

  const shown = (posts ?? []).filter((p) => !isPendingDelete(p.id));

  return (
    <div>
      <PageHeader title="Posts" actions={<Link href="/compose" className="btn-primary btn-sm md:h-10 md:px-4 md:text-sm"><IconPlus size={16} /> New</Link>} />
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div className="seg overflow-x-auto no-scrollbar max-w-full">
          {TABS.map((t) => (
            <button key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)} className="whitespace-nowrap">
              {t.label}
              {counts && counts[t.key] > 0 && <span className={`ml-1.5 text-xs ${t.key === "failed" ? "text-bad" : "text-muted"}`}>{counts[t.key]}</span>}
            </button>
          ))}
        </div>
        <input className="input md:max-w-64 md:ml-auto" placeholder="Search captions & titles" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {posts === null ? (
        <div className="flex justify-center py-10 text-muted"><Spinner size={20} /></div>
      ) : shown.length === 0 ? (
        <Empty title={search ? `Nothing matches “${search}”` : "Nothing here yet"}>
          <Link href="/compose" className="text-accent">Create a post</Link>
        </Empty>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            {shown.map((p) => <PostRow key={p.id} post={p} showDate />)}
          </div>
          {posts.length < total && (
            <div className="flex justify-center mt-4">
              <button className="btn-ghost" disabled={loadingMore} onClick={loadMore}>
                {loadingMore && <Spinner />} Show more ({total - posts.length} left)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
