// YouTube Data API v3. Videos and Shorts are uploaded with the resumable protocol in chunks;
// future public posts are uploaded right away as private with status.publishAt so YouTube
// itself flips them public on time.
import fs from "node:fs";
import { Readable } from "node:stream";
import { accessTokenOf, refreshTokenOf, saveTokens, type AccountRow } from "../accounts";
import { config } from "../config";
import { PublishError } from "../errors";
import { mediaFilePath, type MediaRow } from "../media";
import { mediaForTarget, ytDescription } from "../rules";
import { bodyJson, call } from "./http";
import type { PublishContext, PublishResult } from "./types";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"];
export const CHUNK = 32 * 1024 * 1024; // must be a multiple of 256 KiB

export const ytRedirectUri = () => `${config.publicUrl}/api/oauth/youtube/callback`;

export function ytConfigured(): boolean {
  return !!(config.google.clientId && config.google.clientSecret);
}

export function ytAuthorizeUrl(state: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", config.google.clientId);
  u.searchParams.set("redirect_uri", ytRedirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent select_account");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export function ytError(body: any, status: number, during: string): PublishError {
  const e = body?.error ?? {};
  const reason: string = e.errors?.[0]?.reason || e.status || (typeof body?.error === "string" ? body.error : "");
  const msg = e.message || body?.error_description || `HTTP ${status}`;
  const text = `YouTube ${during}: ${msg}${reason ? ` (${reason})` : ""}`;
  if (status === 401 || reason === "invalid_grant" || reason === "authError") {
    return new PublishError(`${text}. Reconnect the channel.`, { reconnect: true });
  }
  if (reason === "quotaExceeded" || reason === "uploadLimitExceeded") {
    return new PublishError(`${text}. Daily limit reached; retry after it resets (midnight Pacific).`);
  }
  if (reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") {
    return new PublishError(`${text}. Reconnect and grant all requested permissions.`, { reconnect: true });
  }
  const retryable = status >= 500 || status === 429 || ["rateLimitExceeded", "userRateLimitExceeded", "backendError"].includes(reason);
  return new PublishError(text, { retryable });
}

async function tokenRequest(params: Record<string, string>) {
  const res = await call("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams(params) });
  const body = await bodyJson(res);
  if (!res.ok) throw ytError(body, res.status === 400 && body.error === "invalid_grant" ? 401 : res.status, "auth");
  return body as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function ytExchangeCode(code: string) {
  const t = await tokenRequest({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: ytRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await call(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  const body = await bodyJson(res);
  if (!res.ok) throw ytError(body, res.status, "channel lookup");
  const ch = body.items?.[0];
  if (!ch) throw new PublishError("This Google account has no YouTube channel. Create one, then connect again.");
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    channelId: ch.id as string,
    name: ch.snippet.title as string,
    username: (ch.snippet.customUrl as string) ?? null,
    avatarUrl: (ch.snippet.thumbnails?.default?.url as string) ?? null,
  };
}

export async function ytAccessToken(account: AccountRow, force = false): Promise<string> {
  if (!force && account.token_expires_at && account.token_expires_at > Date.now() + 120_000) return accessTokenOf(account);
  const refresh = refreshTokenOf(account);
  if (!refresh) throw new PublishError("No refresh token stored. Reconnect the channel.", { reconnect: true });
  const t = await tokenRequest({
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  saveTokens(account.id, { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

async function ytJson(token: string, method: string, url: string, during: string, body?: unknown) {
  const res = await call(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await bodyJson(res);
  if (!res.ok) throw ytError(json, res.status, during);
  return json;
}

export async function ytPlaylists(account: AccountRow): Promise<{ id: string; title: string }[]> {
  const token = await ytAccessToken(account);
  const out: { id: string; title: string }[] = [];
  let page = "";
  do {
    const b = await ytJson(token, "GET", `${API}/playlists?part=snippet&mine=true&maxResults=50${page ? `&pageToken=${page}` : ""}`, "playlists");
    for (const p of b.items ?? []) out.push({ id: p.id, title: p.snippet.title });
    page = b.nextPageToken ?? "";
  } while (page && out.length < 500);
  return out;
}

function fileChunk(path: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(fs.createReadStream(path, { start, end })) as unknown as ReadableStream;
}

/** Asks the upload session how many bytes it has. Returns the video resource if already complete. */
async function uploadStatus(session: string, token: string, total: number): Promise<{ done: any } | { offset: number } | null> {
  const res = await call(session, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Range": `bytes */${total}`, "Content-Length": "0" } });
  if (res.status === 200 || res.status === 201) return { done: await bodyJson(res) };
  if (res.status === 308) {
    const range = res.headers.get("range");
    return { offset: range ? Number(range.split("-")[1]) + 1 : 0 };
  }
  if (res.status === 404 || res.status === 410) return null;
  throw ytError(await bodyJson(res), res.status, "upload status");
}

async function uploadFile(ctx: PublishContext, token: string, file: MediaRow, metadata: unknown, notify: boolean): Promise<any> {
  const path = mediaFilePath(file);
  const total = fs.statSync(path).size;
  let session: string | null = ctx.target.container_id?.startsWith("upload:") ? ctx.target.container_id.slice(7) : null;
  let offset = 0;

  if (session) {
    const s = await uploadStatus(session, token, total);
    if (s && "done" in s) return s.done;
    if (s) {
      offset = s.offset;
      ctx.log("info", `Resuming upload at ${Math.round((offset / total) * 100)}%.`);
    } else session = null;
  }
  if (!session) {
    const res = await call(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${notify}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(total),
        "X-Upload-Content-Type": file.mime,
      },
      body: JSON.stringify(metadata),
    });
    if (!res.ok) throw ytError(await bodyJson(res), res.status, "upload init");
    session = res.headers.get("location");
    if (!session) throw new PublishError("YouTube didn't return an upload session.", { retryable: true });
    ctx.saveContainer(`upload:${session}`);
  }

  let failures = 0;
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total) - 1;
    let res: Response;
    try {
      res = await call(session, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Length": String(end - offset + 1), "Content-Range": `bytes ${offset}-${end}/${total}`, "Content-Type": file.mime },
        body: fileChunk(path, offset, end),
        duplex: "half",
      });
    } catch (e) {
      if (++failures > 5) throw e;
      await ctx.sleep(2 ** failures * 1000);
      const s = await uploadStatus(session, token, total);
      if (!s) throw new PublishError("Upload session was lost.", { retryable: true });
      if ("done" in s) return s.done;
      offset = s.offset;
      continue;
    }
    if (res.status === 200 || res.status === 201) return bodyJson(res);
    if (res.status === 308) {
      const range = res.headers.get("range");
      offset = range ? Number(range.split("-")[1]) + 1 : 0;
      failures = 0;
      continue;
    }
    const body = await bodyJson(res);
    if (res.status >= 500 && ++failures <= 5) {
      await ctx.sleep(2 ** failures * 1000);
      const s = await uploadStatus(session, token, total);
      if (!s) throw new PublishError("Upload session was lost.", { retryable: true });
      if ("done" in s) return s.done;
      offset = s.offset;
      continue;
    }
    throw ytError(body, res.status, "upload");
  }
  // All bytes acknowledged with 308 but no final response; ask once more.
  const s = await uploadStatus(session, token, total);
  if (s && "done" in s) return s.done;
  throw new PublishError("Upload finished but YouTube didn't confirm the video.", { retryable: true });
}

async function setThumbnail(ctx: PublishContext, token: string, videoId: string) {
  const id = ctx.options.thumbnailMediaId;
  const m = id ? ctx.lookupMedia(id) : undefined;
  if (!m) return;
  try {
    const data = await fs.promises.readFile(mediaFilePath(m));
    const res = await call(`${UPLOAD}/thumbnails/set?videoId=${videoId}&uploadType=media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": m.mime },
      body: data,
    });
    if (!res.ok) throw ytError(await bodyJson(res), res.status, "thumbnail");
    ctx.log("info", "Custom thumbnail set.");
  } catch (e) {
    ctx.log("warn", `Thumbnail not set (custom thumbnails need a verified channel): ${(e as Error).message}`);
  }
}

async function addToPlaylist(ctx: PublishContext, token: string, videoId: string) {
  const playlistId = ctx.options.playlistId;
  if (!playlistId) return;
  try {
    await ytJson(token, "POST", `${API}/playlistItems?part=snippet`, "playlist", {
      snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
    });
    ctx.log("info", "Added to playlist.");
  } catch (e) {
    ctx.log("warn", `Not added to playlist: ${(e as Error).message}`);
  }
}

export async function ytPublish(ctx: PublishContext): Promise<PublishResult> {
  let token = await ytAccessToken(ctx.account);
  const o = ctx.options;
  const ct = ctx.target.content_type;
  const scheduledAt = ctx.post.scheduled_at ?? ctx.now();
  const description = ytDescription(ctx.post.caption, o);
  const privacy = o.privacy ?? "public";
  const snippet = { title: (o.title || "").trim(), description, tags: o.tags?.length ? o.tags : undefined, categoryId: o.categoryId || "22" };

  if (ct === "yt_live") {
    const b = await ytJson(token, "POST", `${API}/liveBroadcasts?part=snippet,status,contentDetails`, "create live event", {
      snippet: { title: snippet.title, description, scheduledStartTime: new Date(scheduledAt).toISOString() },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: !!o.madeForKids },
      contentDetails: { enableAutoStart: false, enableAutoStop: true, enableDvr: true, recordFromStart: true },
    });
    ctx.log("info", `Live event ${b.id} created. Start streaming to it from YouTube Studio or your encoder.`);
    await setThumbnail(ctx, token, b.id);
    await addToPlaylist(ctx, token, b.id);
    return { status: "platform_scheduled", externalId: b.id, externalUrl: `https://www.youtube.com/watch?v=${b.id}` };
  }

  const video = mediaForTarget(ct, ctx.media)[0];
  if (!video) throw new PublishError("No video attached.");
  const native = o.nativeSchedule !== false && privacy === "public" && scheduledAt > ctx.now() + 60_000;
  const status: Record<string, unknown> = {
    privacyStatus: native ? "private" : privacy,
    selfDeclaredMadeForKids: !!o.madeForKids,
    containsSyntheticMedia: !!o.syntheticMedia,
  };
  if (native) status.publishAt = new Date(scheduledAt).toISOString();

  ctx.log("info", native ? `Uploading; YouTube will publish at ${status.publishAt}.` : "Uploading video.");
  let result: any;
  try {
    result = await uploadFile(ctx, token, video, { snippet, status }, o.notifySubscribers !== false);
  } catch (e) {
    if (e instanceof PublishError && e.reconnect) {
      // Access token may have been revoked mid-upload; one forced refresh before giving up.
      token = await ytAccessToken(ctx.account, true);
      result = await uploadFile(ctx, token, video, { snippet, status }, o.notifySubscribers !== false);
    } else throw e;
  }
  const id = result.id as string;
  ctx.log("info", `Uploaded as ${id}.`);
  const got = result.status?.privacyStatus;
  if (got === "private" && !native && privacy !== "private") {
    ctx.log("warn", "YouTube kept this video private. Unverified API projects can only upload private videos until they pass Google's audit.");
  }
  await setThumbnail(ctx, token, id);
  await addToPlaylist(ctx, token, id);
  const url = ct === "yt_short" ? `https://youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
  return { status: native ? "platform_scheduled" : "published", externalId: id, externalUrl: url };
}
