"use client";

import { useEffect, useState } from "react";

const EVENT = "app-toast";

/** Shows a short confirmation. Survives client-side navigation because the Toaster lives in the app shell. */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMsg({ text: (e as CustomEvent<string>).detail, key: Date.now() });
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2800);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div role="status" key={msg.key} className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 z-[70] rounded-xl bg-ink text-bg px-4 py-2.5 text-sm shadow-lg max-w-[90vw]">
      {msg.text}
    </div>
  );
}
