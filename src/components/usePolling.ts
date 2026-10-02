"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `fn` now and every `ms`, but only while the tab is visible; refreshes as soon as
 * the tab comes back. Background tabs and locked phones stop hitting the server.
 */
export function usePolling(fn: () => void, ms: number, deps: unknown[] = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => ref.current(), ms);
    };
    const onVis = () => {
      if (document.hidden) clearInterval(timer);
      else {
        ref.current();
        start();
      }
    };
    ref.current();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}
