// Simulated publishing for demo accounts: exercises the whole pipeline without calling any API.
// Put "#fail" in the caption to simulate a platform error.
import fs from "node:fs";
import { PublishError } from "../errors";
import { mediaFilePath } from "../media";
import { captionFor, mediaForTarget } from "../rules";
import { randomId } from "../crypto";
import type { PublishContext, PublishResult } from "./types";

export async function demoPublish(ctx: PublishContext): Promise<PublishResult> {
  const ct = ctx.target.content_type;
  for (const m of mediaForTarget(ct, ctx.media)) {
    if (!fs.existsSync(mediaFilePath(m))) throw new PublishError(`Media file missing on disk: ${m.original_name}`);
  }
  ctx.log("info", `[demo] Simulating ${ct} publish.`);
  await ctx.sleep(1500);
  if (/(^|\s)#fail\b/i.test(captionFor(ctx.post.caption, ctx.options))) {
    throw new PublishError("[demo] Simulated platform error (caption contains #fail).");
  }
  const id = randomId(8);
  const yt = ct.startsWith("yt_");
  const url = yt ? `https://www.youtube.com/watch?v=demo-${id}` : `https://www.instagram.com/p/demo-${id}/`;
  const o = ctx.options;
  const native = o.nativeSchedule !== false && (o.privacy ?? "public") === "public" && (ctx.post.scheduled_at ?? 0) > ctx.now() + 60_000;
  const scheduled = ct === "yt_live" || ((ct === "yt_video" || ct === "yt_short") && native);
  return { status: scheduled ? "platform_scheduled" : "published", externalId: `demo-${id}`, externalUrl: url };
}
