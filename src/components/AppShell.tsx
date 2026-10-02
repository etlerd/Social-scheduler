"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { IconCalendar, IconImage, IconList, IconLogout, IconPlus, IconUsers } from "./icons";

const NAV = [
  { href: "/", label: "Calendar", icon: IconCalendar },
  { href: "/posts", label: "Posts", icon: IconList },
  { href: "/media", label: "Media", icon: IconImage },
  { href: "/accounts", label: "Accounts", icon: IconUsers },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  return (
    <div className="min-h-dvh md:pl-60">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-line bg-surface px-3 py-5">
        <Link href="/" className="flex items-center gap-2.5 px-3 mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span className="font-semibold">Scheduler</span>
        </Link>
        <Link href="/compose" className="btn-primary mb-4 mx-1">
          <IconPlus size={18} /> New post
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 h-10 text-sm ${active(href) ? "bg-surface-2 font-medium" : "text-muted hover:text-ink hover:bg-surface-2"}`}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
        </nav>
        <button onClick={logout} className="mt-auto flex items-center gap-3 rounded-xl px-3 h-10 text-sm text-muted hover:text-ink hover:bg-surface-2">
          <IconLogout size={18} /> Sign out
        </button>
      </aside>

      <main className="mx-auto max-w-6xl px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-12">{children}</main>

      {/* Mobile tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line bg-surface/95 backdrop-blur safe-bottom">
        <div className="grid grid-cols-5 h-16">
          {NAV.slice(0, 2).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${active(href) ? "text-accent" : "text-muted"}`}>
              <Icon size={22} />
              {label}
            </Link>
          ))}
          <Link href="/compose" className="flex items-center justify-center" aria-label="New post">
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-accent text-accent-ink shadow-lg">
              <IconPlus size={24} />
            </span>
          </Link>
          {NAV.slice(2).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${active(href) ? "text-accent" : "text-muted"}`}>
              <Icon size={22} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5 min-h-10">
      <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
