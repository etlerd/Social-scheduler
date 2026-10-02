"use client";

import { useEffect, useState } from "react";

const EVENT = "app-toast";

interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastMsg {
  text: string;
  action?: ToastAction;
  ms?: number;
}

/** Shows a short confirmation. Survives client-side navigation because the Toaster lives in the app shell. */
export function toast(text: string, opts: { action?: ToastAction; ms?: number } = {}) {
  window.dispatchEvent(new CustomEvent<ToastMsg>(EVENT, { detail: { text, ...opts } }));
}

/* Deletions wait a few seconds so they can be undone. Lists hide pending ones meanwhile. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const PENDING_EVENT = "pending-deletes";

export function isPendingDelete(id: string) {
  return pending.has(id);
}

export function onPendingDeletesChange(fn: () => void) {
  window.addEventListener(PENDING_EVENT, fn);
  return () => window.removeEventListener(PENDING_EVENT, fn);
}

export function deleteWithUndo(id: string, text: string, commit: () => Promise<void>, onError: (e: Error) => void) {
  const ms = 6000;
  const timer = setTimeout(() => {
    pending.delete(id);
    commit()
      .catch((e: Error) => {
        onError(e);
      })
      .finally(() => window.dispatchEvent(new Event(PENDING_EVENT)));
  }, ms);
  pending.set(id, timer);
  window.dispatchEvent(new Event(PENDING_EVENT));
  toast(text, {
    ms,
    action: {
      label: "Undo",
      onClick: () => {
        clearTimeout(timer);
        pending.delete(id);
        window.dispatchEvent(new Event(PENDING_EVENT));
        toast("Restored");
      },
    },
  });
}

// Commit pending deletions if the tab is closing, so "deleted" means deleted.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const [id, timer] of pending) {
      clearTimeout(timer);
      navigator.sendBeacon?.(`/api/posts/${id}/delete`);
    }
  });
}

export function Toaster() {
  const [msg, setMsg] = useState<(ToastMsg & { key: number }) | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMsg({ ...(e as CustomEvent<ToastMsg>).detail, key: Date.now() });
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ms ?? 2800);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div role="status" key={msg.key} className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 z-[70] flex items-center gap-4 rounded-xl bg-ink text-bg pl-4 pr-2 py-2 text-sm shadow-lg max-w-[92vw]">
      <span className="py-0.5">{msg.text}</span>
      {msg.action && (
        <button
          className="rounded-lg px-3 py-1 font-semibold text-accent hover:bg-white/10"
          onClick={() => {
            msg.action!.onClick();
          }}
        >
          {msg.action.label}
        </button>
      )}
    </div>
  );
}
