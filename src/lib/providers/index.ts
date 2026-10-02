import { demoPublish } from "./demo";
import { igPublish } from "./instagram";
import { ytPublish } from "./youtube";
import type { PublishContext, PublishResult } from "./types";

export function publishTarget(ctx: PublishContext): Promise<PublishResult> {
  if (ctx.account.mode === "demo") return demoPublish(ctx);
  return ctx.account.platform === "instagram" ? igPublish(ctx) : ytPublish(ctx);
}
