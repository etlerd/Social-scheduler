import { CONTENT_TYPES } from "@/lib/rules";
import type { Post, PostTarget } from "@/lib/types";

export function postLabel(p: Post): string {
  const yt = p.targets.find((t) => t.contentType.startsWith("yt_") && t.options.title?.trim());
  if (yt) return yt.options.title!.trim();
  const line = p.caption.split("\n").find((l) => l.trim());
  return line?.trim() || "(no caption)";
}

export function targetLabel(t: PostTarget): string {
  return CONTENT_TYPES[t.contentType].label;
}

export function platformsOf(p: Post): ("instagram" | "youtube")[] {
  return [...new Set(p.targets.map((t) => CONTENT_TYPES[t.contentType].platform))];
}

/** platform_scheduled reads as published once its time has passed. */
export function effectiveTargetStatus(t: PostTarget, scheduledAt: number | null) {
  if (t.status === "platform_scheduled" && scheduledAt != null && scheduledAt <= Date.now()) return "published" as const;
  return t.status;
}
