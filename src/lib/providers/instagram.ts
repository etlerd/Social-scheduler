// Instagram API with Instagram Login (graph.instagram.com). Requires a professional
// (Business or Creator) account. The API has no native scheduling, so this server
// must be running at publish time.
import { accessTokenOf, saveTokens, type AccountRow } from "../accounts";
import { config } from "../config";
import { PublishError } from "../errors";
import { publicMediaUrl, type MediaRow } from "../media";
import { mediaForTarget } from "../rules";
import { bodyJson, call } from "./http";
import type { PublishContext, PublishResult } from "./types";

const SCOPES = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments"];
const DAY = 86400_000;

const graph = () => `https://graph.instagram.com/${config.instagram.graphVersion}`;
export const igRedirectUri = () => `${config.publicUrl}/api/oauth/instagram/callback`;

export function igConfigured(): boolean {
  return !!(config.instagram.appId && config.instagram.appSecret);
}

export function igAuthorizeUrl(state: string): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", config.instagram.appId);
  u.searchParams.set("redirect_uri", igRedirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

export function igError(body: any, status: number, during: string): PublishError {
  const e = body?.error ?? {};
  const code = Number(e.code);
  const msg = e.error_user_msg || e.message || body?.error_message || `HTTP ${status}`;
  const text = `Instagram ${during}: ${msg}${e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`;
  if (code === 190) return new PublishError(`${text}. Reconnect the account.`, { reconnect: true });
  if (code === 10 || (code >= 200 && code < 300)) return new PublishError(`${text}. The app lacks a required permission; reconnect and grant it.`, { reconnect: true });
  const retryable = e.is_transient === true || [1, 2, 4, 9, 17, 32, 341, 613].includes(code) || status >= 500 || status === 429;
  return new PublishError(text, { retryable });
}

async function igGet(path: string, params: Record<string, string>, during: string) {
  const u = new URL(path.startsWith("http") ? path : `${graph()}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await call(u.toString());
  const body = await bodyJson(res);
  if (!res.ok || body.error) throw igError(body, res.status, during);
  return body;
}

async function igPost(path: string, params: Record<string, string | undefined>, during: string) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) form.set(k, v);
  const res = await call(`${graph()}${path}`, { method: "POST", body: form });
  const body = await bodyJson(res);
  if (!res.ok || body.error) throw igError(body, res.status, during);
  return body;
}

export async function igExchangeCode(code: string) {
  const form = new URLSearchParams({
    client_id: config.instagram.appId,
    client_secret: config.instagram.appSecret,
    grant_type: "authorization_code",
    redirect_uri: igRedirectUri(),
    code: code.replace(/#_$/, ""),
  });
  const res = await call("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
  const body = await bodyJson(res);
  const short = body?.data?.[0]?.access_token ?? body?.access_token;
  if (!res.ok || !short) throw igError(body, res.status, "token exchange");
  const long = await igGet("https://graph.instagram.com/access_token", {
    grant_type: "ig_exchange_token",
    client_secret: config.instagram.appSecret,
    access_token: short,
  }, "long-lived token exchange");
  const profile = await igGet("/me", { fields: "user_id,username,name,profile_picture_url,account_type", access_token: long.access_token }, "profile");
  return {
    accessToken: long.access_token as string,
    expiresAt: Date.now() + Number(long.expires_in || 60 * 86400) * 1000,
    userId: String(profile.user_id ?? profile.id),
    username: profile.username as string,
    name: (profile.name as string) || (profile.username as string),
    avatarUrl: (profile.profile_picture_url as string) ?? null,
    accountType: profile.account_type as string | undefined,
  };
}

/** Long-lived tokens last 60 days and can be refreshed once they are at least 24h old. */
export async function igRefreshIfNeeded(account: AccountRow, force = false): Promise<string> {
  const token = accessTokenOf(account);
  const exp = account.token_expires_at ?? 0;
  if (exp && exp < Date.now()) throw new PublishError("Instagram token expired. Reconnect the account.", { reconnect: true });
  const issuedAt = Number(JSON.parse(account.meta || "{}").tokenIssuedAt ?? 0);
  const due = force ? exp - Date.now() < 30 * DAY : exp - Date.now() < 7 * DAY;
  if (!due || Date.now() - issuedAt < DAY) return token;
  const body = await igGet("https://graph.instagram.com/refresh_access_token", { grant_type: "ig_refresh_token", access_token: token }, "token refresh");
  const expiresAt = Date.now() + Number(body.expires_in || 60 * 86400) * 1000;
  saveTokens(account.id, { accessToken: body.access_token, expiresAt, meta: { tokenIssuedAt: Date.now() } });
  return body.access_token;
}

type ContainerStatus = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

async function containerStatus(id: string, token: string): Promise<{ code: ContainerStatus; detail?: string }> {
  const b = await igGet(`/${id}`, { fields: "status_code,status", access_token: token }, "container status");
  return { code: b.status_code, detail: b.status };
}

async function waitForContainer(ctx: PublishContext, id: string, token: string, isVideo: boolean) {
  const deadline = ctx.now() + (isVideo ? 20 : 3) * 60_000;
  let delay = isVideo ? 5000 : 1500;
  for (;;) {
    const s = await containerStatus(id, token);
    if (s.code === "FINISHED" || s.code === "PUBLISHED") return;
    if (s.code === "ERROR") throw new PublishError(`Instagram couldn't process the media${s.detail ? `: ${s.detail}` : ""}.`);
    if (s.code === "EXPIRED") throw new PublishError("Instagram media container expired before publishing.", { retryable: true });
    if (ctx.now() > deadline) throw new PublishError("Timed out waiting for Instagram to process the media.", { retryable: true });
    await ctx.sleep(delay);
    delay = Math.min(delay * 1.5, 20_000);
  }
}

async function createContainer(ctx: PublishContext, token: string): Promise<{ id: string; isVideo: boolean }> {
  const ig = ctx.account.external_id;
  const o = ctx.options;
  const caption = ctx.post.caption || undefined;
  const ct = ctx.target.content_type;
  const items = mediaForTarget(ct, ctx.media);
  if (!items.length) throw new PublishError("No media to publish.");
  const url = (m: MediaRow) => publicMediaUrl(m);

  if (ct === "ig_image") {
    const r = await igPost(`/${ig}/media`, { image_url: url(items[0]), caption, access_token: token }, "create photo");
    return { id: r.id, isVideo: false };
  }
  if (ct === "ig_reel") {
    const cover = o.coverMediaId ? ctx.lookupMedia(o.coverMediaId) : undefined;
    const r = await igPost(`/${ig}/media`, {
      media_type: "REELS",
      video_url: url(items[0]),
      caption,
      share_to_feed: String(o.shareToFeed !== false),
      cover_url: cover ? url(cover) : undefined,
      thumb_offset: !cover && o.thumbOffsetSec ? String(Math.round(o.thumbOffsetSec * 1000)) : undefined,
      access_token: token,
    }, "create reel");
    return { id: r.id, isVideo: true };
  }
  if (ct === "ig_story") {
    const m = items[0];
    const r = await igPost(`/${ig}/media`, {
      media_type: "STORIES",
      ...(m.kind === "video" ? { video_url: url(m) } : { image_url: url(m) }),
      access_token: token,
    }, "create story");
    return { id: r.id, isVideo: m.kind === "video" };
  }
  // Carousel: create each child, wait for them, then the parent.
  const children: string[] = [];
  for (const [i, m] of items.entries()) {
    const r = await igPost(`/${ig}/media`, {
      is_carousel_item: "true",
      ...(m.kind === "video" ? { media_type: "VIDEO", video_url: url(m) } : { image_url: url(m) }),
      access_token: token,
    }, `create carousel item ${i + 1}`);
    children.push(r.id);
  }
  ctx.log("info", `Created ${children.length} carousel items; waiting for processing.`);
  for (const [i, id] of children.entries()) await waitForContainer(ctx, id, token, items[i].kind === "video");
  const r = await igPost(`/${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token }, "create carousel");
  return { id: r.id, isVideo: false };
}

export async function igPublish(ctx: PublishContext): Promise<PublishResult> {
  const token = await igRefreshIfNeeded(ctx.account);
  const ig = ctx.account.external_id;
  let container = ctx.target.container_id;
  let isVideo = mediaForTarget(ctx.target.content_type, ctx.media).some((m) => m.kind === "video");

  if (container) {
    const s = await containerStatus(container, token).catch(() => ({ code: "ERROR" as const }));
    if (s.code === "PUBLISHED") {
      ctx.log("warn", "Container was already published by an earlier attempt.");
      return { status: "published" };
    }
    if (s.code === "EXPIRED" || s.code === "ERROR") {
      ctx.log("info", `Previous container ${s.code.toLowerCase()}; creating a new one.`);
      container = null;
      ctx.saveContainer(null);
    } else {
      ctx.log("info", "Resuming existing media container.");
    }
  }
  if (!container) {
    const c = await createContainer(ctx, token);
    container = c.id;
    isVideo = c.isVideo;
    ctx.saveContainer(container);
    ctx.log("info", `Media container ${container} created.`);
  }
  await waitForContainer(ctx, container, token, isVideo);
  const pub = await igPost(`/${ig}/media_publish`, { creation_id: container, access_token: token }, "publish");
  const mediaId = String(pub.id);
  ctx.log("info", `Published as media ${mediaId}.`);

  let permalink: string | null = null;
  try {
    permalink = (await igGet(`/${mediaId}`, { fields: "permalink", access_token: token }, "permalink")).permalink ?? null;
  } catch (e) {
    ctx.log("warn", `Couldn't fetch permalink: ${(e as Error).message}`);
  }
  const comment = ctx.options.firstComment?.trim();
  if (comment && ctx.target.content_type !== "ig_story") {
    try {
      await igPost(`/${mediaId}/comments`, { message: comment, access_token: token }, "first comment");
      ctx.log("info", "First comment posted.");
    } catch (e) {
      ctx.log("warn", `Post is live but the first comment failed: ${(e as Error).message}`);
    }
  }
  return { status: "published", externalId: mediaId, externalUrl: permalink };
}
