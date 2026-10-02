import { cookies } from "next/headers";
import { safeEqual, sign } from "./crypto";

export const SESSION_COOKIE = "ss_session";
const SESSION_DAYS = 30;

export function createSessionToken(now = Date.now()): string {
  const exp = String(now + SESSION_DAYS * 86400_000);
  return `${exp}.${sign(`session:${exp}`)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || Number(exp) < now) return false;
  try {
    return safeEqual(mac, sign(`session:${exp}`));
  } catch {
    return false;
  }
}

export const sessionMaxAge = SESSION_DAYS * 86400;

export async function isAuthed(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

/** Returns a 401 response when the request is not authenticated, otherwise null. */
export async function denyUnlessAuthed(): Promise<Response | null> {
  return (await isAuthed()) ? null : Response.json({ error: "Unauthorized" }, { status: 401 });
}
