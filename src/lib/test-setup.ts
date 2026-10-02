import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetDbForTests } from "./db";
import { insertMedia, type MediaRow } from "./media";
import { upsertAccount } from "./accounts";

export function setupTestEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-test-"));
  process.env.DATA_DIR = dir;
  process.env.SECRET_KEY = "x".repeat(40);
  process.env.PUBLIC_URL = "https://sched.example.com";
  process.env.GOOGLE_CLIENT_ID = "gid";
  process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
  resetDbForTests(new Database(":memory:"));
  return dir;
}

let n = 0;
export function addMedia(dir: string, over: Partial<MediaRow> = {}, bytes = 1000): MediaRow {
  n++;
  const kind = over.kind ?? (over.mime?.startsWith("video/") ? "video" : "image");
  const row: MediaRow = {
    id: `m${n}`,
    file_name: `file${n}${kind === "video" ? ".mp4" : ".jpg"}`,
    original_name: `f${n}`,
    mime: kind === "video" ? "video/mp4" : "image/jpeg",
    size: bytes,
    width: kind === "video" ? 1080 : 1080,
    height: kind === "video" ? 1920 : 1350,
    duration: kind === "video" ? 30 : null,
    kind,
    created_at: Date.now(),
    ...over,
  };
  fs.writeFileSync(path.join(dir, "media", row.file_name), Buffer.alloc(bytes, 7));
  insertMedia(row);
  return row;
}

export function addAccount(platform: "instagram" | "youtube", mode: "live" | "demo" = "live") {
  return upsertAccount({
    platform,
    mode,
    externalId: `${platform}-${++n}`,
    name: `${platform} acct`,
    accessToken: "tok",
    refreshToken: platform === "youtube" ? "refresh" : undefined,
    tokenExpiresAt: Date.now() + 30 * 86400_000,
    meta: { tokenIssuedAt: Date.now() },
  });
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Minimal fetch router; records calls. */
export function mockFetch(routes: [RegExp | string, Handler][]) {
  const calls: { method: string; url: string; body?: unknown; headers: Record<string, string> }[] = [];
  const fn = async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    let body: unknown = init.body;
    if (body instanceof URLSearchParams) body = Object.fromEntries(body);
    else if (body && typeof (body as ReadableStream).getReader === "function") {
      body = Buffer.from(await new Response(body as ReadableStream).arrayBuffer()).length;
    }
    calls.push({ method, url: url.toString(), body, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    const key = `${method} ${url.origin}${url.pathname}`;
    for (const [pat, h] of routes) {
      if (typeof pat === "string" ? key === pat : pat.test(key)) return h(url, init);
    }
    throw new Error(`Unmocked fetch: ${key}`);
  };
  return { fn, calls };
}

export const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
