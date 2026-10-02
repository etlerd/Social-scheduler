import { cookies } from "next/headers";
import { route, readJson } from "@/lib/api";
import { SESSION_COOKIE, createSessionToken, sessionMaxAge } from "@/lib/auth";
import { config, setupProblems } from "@/lib/config";
import { safeEqual } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";

const failures: number[] = [];

export const POST = route(async (req) => {
  const problems = setupProblems();
  if (problems.length) throw new ApiError(503, `Server not configured: ${problems.join(" ")}`);
  const now = Date.now();
  while (failures.length && failures[0] < now - 15 * 60_000) failures.shift();
  if (failures.length >= 10) throw new ApiError(429, "Too many failed attempts. Wait 15 minutes.");
  const { password } = await readJson<{ password?: string }>(req);
  if (!password || !safeEqual(password, config.appPassword)) {
    failures.push(now);
    await new Promise((r) => setTimeout(r, 500));
    throw new ApiError(401, "Wrong password.");
  }
  (await cookies()).set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https://"),
    path: "/",
    maxAge: sessionMaxAge,
  });
  return Response.json({ ok: true });
}, { auth: false });
