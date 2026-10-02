import type { AccountRow } from "../accounts";
import type { MediaRow } from "../media";
import type { PostRow, TargetRow } from "../posts";
import type { TargetOptions } from "../types";

export interface PublishContext {
  target: TargetRow;
  options: TargetOptions;
  account: AccountRow;
  post: PostRow;
  /** Post media in order. */
  media: MediaRow[];
  lookupMedia: (id: string) => MediaRow | undefined;
  log: (level: "info" | "warn" | "error", message: string) => void;
  /** Persist an intermediate platform id (Instagram container) so a retry can resume instead of re-posting. */
  saveContainer: (id: string | null) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface PublishResult {
  status: "published" | "platform_scheduled";
  externalId?: string | null;
  externalUrl?: string | null;
}
