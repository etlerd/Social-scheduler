// For hosts that sleep when idle: an external cron can hit this to run due posts.
import { config } from "@/lib/config";
import { safeEqual } from "@/lib/crypto";
import { runDue } from "@/lib/worker";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!config.cronSecret || !safeEqual(auth, `Bearer ${config.cronSecret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const jobs = runDue();
  await Promise.allSettled(jobs);
  return Response.json({ processed: jobs.length });
}
