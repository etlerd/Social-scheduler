import { route, readJson } from "@/lib/api";
import { upsertAccount } from "@/lib/accounts";
import { config } from "@/lib/config";
import { randomId } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";

export const POST = route(async (req) => {
  if (!config.demoAccounts) throw new ApiError(403, "Demo accounts are disabled (ENABLE_DEMO_ACCOUNTS).");
  const { platform } = await readJson<{ platform?: string }>(req);
  if (platform !== "instagram" && platform !== "youtube") throw new ApiError(400, "Invalid platform");
  const suffix = randomId(3).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const id = upsertAccount({
    platform,
    mode: "demo",
    externalId: randomId(8),
    name: platform === "instagram" ? `Demo IG ${suffix}` : `Demo Channel ${suffix}`,
    username: platform === "instagram" ? `demo_${suffix}` : `@demo${suffix}`,
  });
  return Response.json({ id }, { status: 201 });
});
