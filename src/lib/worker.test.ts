import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAccount, addMedia, json, mockFetch, setupTestEnv } from "./test-setup";
import { getPost, savePost } from "./posts";
import { processTarget, runDue } from "./worker";
import { db } from "./db";
import { getAccountRow } from "./accounts";
import { CHUNK } from "./providers/youtube";

const G = "https://graph.instagram.com/v23.0";
let dir: string;
const noSleep = async () => {};

beforeEach(() => {
  dir = setupTestEnv();
});
afterEach(() => vi.unstubAllGlobals());

function claim(postId: string) {
  db().prepare("UPDATE post_targets SET status = 'publishing', attempts = attempts + 1 WHERE post_id = ?").run(postId);
  return (db().prepare("SELECT id FROM post_targets WHERE post_id = ?").all(postId) as { id: string }[]).map((r) => r.id);
}

describe("instagram publishing", () => {
  it("publishes a reel: container → poll → publish → permalink → first comment", async () => {
    const acct = addAccount("instagram");
    const igId = getAccountRow(acct)!.external_id;
    const v = addMedia(dir, { kind: "video" });
    const post = savePost({ caption: "hi", mediaIds: [v.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "ig_reel", options: { firstComment: "#tags", shareToFeed: true } }] });
    let polls = 0;
    const { fn, calls } = mockFetch([
      [`POST ${G}/${igId}/media`, () => json({ id: "c1" })],
      [`GET ${G}/c1`, () => json({ status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" })],
      [`POST ${G}/${igId}/media_publish`, () => json({ id: "m1" })],
      [`GET ${G}/m1`, () => json({ permalink: "https://www.instagram.com/reel/abc/" })],
      [`POST ${G}/m1/comments`, () => json({ id: "cm1" })],
    ]);
    vi.stubGlobal("fetch", fn);
    const [tid] = claim(post.id);
    await processTarget(tid, { sleep: noSleep });

    const t = getPost(post.id, true)!.targets[0];
    expect(t.status).toBe("published");
    expect(t.externalUrl).toBe("https://www.instagram.com/reel/abc/");
    const create = calls[0].body as Record<string, string>;
    expect(create.media_type).toBe("REELS");
    expect(create.video_url).toBe(`https://sched.example.com/media/${v.file_name}`);
    expect(create.share_to_feed).toBe("true");
    expect(calls.some((c) => c.url.endsWith("/m1/comments"))).toBe(true);
  });

  it("uses an account's own caption when it has one", async () => {
    const acct = addAccount("instagram");
    const igId = getAccountRow(acct)!.external_id;
    const m = addMedia(dir);
    const post = savePost({ caption: "shared", mediaIds: [m.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "ig_image", options: { caption: "just for IG #tag" } }] });
    const { fn, calls } = mockFetch([
      [`POST ${G}/${igId}/media`, () => json({ id: "c1" })],
      [`GET ${G}/c1`, () => json({ status_code: "FINISHED" })],
      [`POST ${G}/${igId}/media_publish`, () => json({ id: "m1" })],
      [`GET ${G}/m1`, () => json({ permalink: "x" })],
    ]);
    vi.stubGlobal("fetch", fn);
    await processTarget(claim(post.id)[0], { sleep: noSleep });
    expect((calls[0].body as Record<string, string>).caption).toBe("just for IG #tag");
  });

  it("publishes a carousel with child containers", async () => {
    const acct = addAccount("instagram");
    const igId = getAccountRow(acct)!.external_id;
    const a = addMedia(dir);
    const b = addMedia(dir);
    const post = savePost({ caption: "c", mediaIds: [a.id, b.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "ig_carousel", options: {} }] });
    let n = 0;
    const { fn, calls } = mockFetch([
      [`POST ${G}/${igId}/media`, () => json({ id: `c${++n}` })],
      [/^GET .*\/c\d$/, () => json({ status_code: "FINISHED" })],
      [`POST ${G}/${igId}/media_publish`, () => json({ id: "m9" })],
      [`GET ${G}/m9`, () => json({ permalink: "https://instagram.com/p/x" })],
    ]);
    vi.stubGlobal("fetch", fn);
    await processTarget(claim(post.id)[0], { sleep: noSleep });
    const creates = calls.filter((c) => c.method === "POST" && c.url.endsWith("/media")).map((c) => c.body as Record<string, string>);
    expect(creates.slice(0, 2).every((c) => c.is_carousel_item === "true")).toBe(true);
    expect(creates[2]).toMatchObject({ media_type: "CAROUSEL", children: "c1,c2", caption: "c" });
    expect(calls.find((c) => c.url.endsWith("media_publish"))!.body).toMatchObject({ creation_id: "c3" });
    expect(getPost(post.id)!.status).toBe("published");
  });

  it("resumes an already-published container instead of posting twice", async () => {
    const acct = addAccount("instagram");
    const m = addMedia(dir);
    const post = savePost({ caption: "", mediaIds: [m.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "ig_image", options: {} }] });
    db().prepare("UPDATE post_targets SET container_id = 'old'").run();
    const { fn, calls } = mockFetch([[`GET ${G}/old`, () => json({ status_code: "PUBLISHED" })]]);
    vi.stubGlobal("fetch", fn);
    await processTarget(claim(post.id)[0], { sleep: noSleep });
    expect(calls).toHaveLength(1);
    expect(getPost(post.id)!.targets[0].status).toBe("published");
  });

  it("retries transient errors with backoff, fails hard on auth errors and flags the account", async () => {
    const acct = addAccount("instagram");
    const igId = getAccountRow(acct)!.external_id;
    const m = addMedia(dir);
    const mk = () => savePost({ caption: "", mediaIds: [m.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "ig_image", options: {} }] });

    const p1 = mk();
    vi.stubGlobal("fetch", mockFetch([[`POST ${G}/${igId}/media`, () => json({ error: { message: "temp", code: 2, is_transient: true } }, 500)]]).fn);
    await processTarget(claim(p1.id)[0], { sleep: noSleep });
    const t1 = getPost(p1.id)!.targets[0];
    expect(t1.status).toBe("scheduled");
    expect(t1.dispatchAt!).toBeGreaterThan(Date.now() + 60_000);

    const p2 = mk();
    vi.stubGlobal("fetch", mockFetch([[`POST ${G}/${igId}/media`, () => json({ error: { message: "Invalid OAuth access token", code: 190 } }, 400)]]).fn);
    await processTarget(claim(p2.id)[0], { sleep: noSleep });
    const t2 = getPost(p2.id)!.targets[0];
    expect(t2.status).toBe("failed");
    expect(t2.error).toMatch(/Reconnect/);
    expect(getAccountRow(acct)!.status).toBe("reconnect");
  });
});

describe("youtube publishing", () => {
  it("uploads in chunks with native scheduling, then adds to playlist", async () => {
    const acct = addAccount("youtube");
    const v = addMedia(dir, { kind: "video", width: 1920, height: 1080 }, CHUNK + 1234);
    const at = Date.now() + 86400_000;
    const post = savePost({
      caption: "desc",
      mediaIds: [v.id],
      mode: "schedule",
      scheduledAt: at,
      targets: [{ accountId: acct, contentType: "yt_video", options: { title: "My video", privacy: "public", tags: ["a"], playlistId: "PL1" } }],
    });
    const session = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc";
    let puts = 0;
    const { fn, calls } = mockFetch([
      ["POST https://www.googleapis.com/upload/youtube/v3/videos", () => json({}, 200, { location: session })],
      ["PUT https://www.googleapis.com/upload/youtube/v3/videos", () =>
        ++puts === 1 ? new Response(null, { status: 308, headers: { range: `bytes=0-${CHUNK - 1}` } }) : json({ id: "vid1", status: { privacyStatus: "private" } })],
      ["POST https://www.googleapis.com/youtube/v3/playlistItems", () => json({ id: "pi" })],
    ]);
    vi.stubGlobal("fetch", fn);
    expect(runDue()).toHaveLength(1); // dispatched immediately despite the future publish time
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 50 && getPost(post.id)!.targets[0].status === "publishing"; i++) await new Promise((r) => setTimeout(r, 20));

    const t = getPost(post.id)!.targets[0];
    expect(t.status).toBe("platform_scheduled");
    expect(t.externalUrl).toBe("https://www.youtube.com/watch?v=vid1");
    const init = JSON.parse(String(calls[0].body));
    expect(init.status).toMatchObject({ privacyStatus: "private", publishAt: new Date(at).toISOString(), selfDeclaredMadeForKids: false });
    expect(init.snippet).toMatchObject({ title: "My video", description: "desc", tags: ["a"] });
    const chunks = calls.filter((c) => c.method === "PUT");
    expect(chunks.map((c) => c.headers["content-range"])).toEqual([`bytes 0-${CHUNK - 1}/${CHUNK + 1234}`, `bytes ${CHUNK}-${CHUNK + 1233}/${CHUNK + 1234}`]);
    expect(chunks.map((c) => c.body)).toEqual([CHUNK, 1234]);
    expect(calls.at(-1)!.body).toContain("PL1");
  });

  it("recovers from a 503 mid-upload by querying the session offset", async () => {
    const acct = addAccount("youtube");
    const v = addMedia(dir, { kind: "video" }, 5000);
    const post = savePost({ caption: "", mediaIds: [v.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "yt_short", options: { title: "S", privacy: "public" } }] });
    const session = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=z";
    const seq = [
      () => new Response("busy", { status: 503 }),
      () => new Response(null, { status: 308, headers: { range: "bytes=0-1999" } }),
      () => json({ id: "s1", status: { privacyStatus: "public" } }),
    ];
    const { fn, calls } = mockFetch([
      ["POST https://www.googleapis.com/upload/youtube/v3/videos", () => json({}, 200, { location: session })],
      ["PUT https://www.googleapis.com/upload/youtube/v3/videos", () => seq.shift()!()],
    ]);
    vi.stubGlobal("fetch", fn);
    await processTarget(claim(post.id)[0], { sleep: noSleep });
    const t = getPost(post.id)!.targets[0];
    expect(t.status).toBe("published");
    expect(t.externalUrl).toBe("https://youtube.com/shorts/s1");
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.headers["content-range"])).toEqual(["bytes 0-4999/5000", "bytes */5000", "bytes 2000-4999/5000"]);
  });

  it("quota exhaustion fails without burning retries", async () => {
    const acct = addAccount("youtube");
    const v = addMedia(dir, { kind: "video" });
    const post = savePost({ caption: "", mediaIds: [v.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "yt_video", options: { title: "T" } }] });
    vi.stubGlobal("fetch", mockFetch([
      ["POST https://www.googleapis.com/upload/youtube/v3/videos", () => json({ error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403)],
    ]).fn);
    await processTarget(claim(post.id)[0], { sleep: noSleep });
    const t = getPost(post.id)!.targets[0];
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/Daily limit/);
  });

  it("creates a scheduled live broadcast", async () => {
    const acct = addAccount("youtube");
    const at = Date.now() + 86400_000;
    const post = savePost({ caption: "join", mediaIds: [], mode: "schedule", scheduledAt: at, targets: [{ accountId: acct, contentType: "yt_live", options: { title: "Live Q&A", privacy: "public" } }] });
    const { fn, calls } = mockFetch([["POST https://www.googleapis.com/youtube/v3/liveBroadcasts", () => json({ id: "live1" })]]);
    vi.stubGlobal("fetch", fn);
    await processTarget(claim(post.id)[0], { sleep: noSleep });
    expect(getPost(post.id)!.targets[0].status).toBe("platform_scheduled");
    expect(JSON.parse(String(calls[0].body)).snippet.scheduledStartTime).toBe(new Date(at).toISOString());
  });

  it("refreshes an expired access token first", async () => {
    const acct = addAccount("youtube");
    db().prepare("UPDATE accounts SET token_expires_at = ? WHERE id = ?").run(Date.now() - 1000, acct);
    const post = savePost({ caption: "", mediaIds: [], mode: "schedule", scheduledAt: Date.now() + 86400_000, targets: [{ accountId: acct, contentType: "yt_live", options: { title: "L" } }] });
    const { fn, calls } = mockFetch([
      ["POST https://oauth2.googleapis.com/token", () => json({ access_token: "new", expires_in: 3600 })],
      ["POST https://www.googleapis.com/youtube/v3/liveBroadcasts", () => json({ id: "l2" })],
    ]);
    vi.stubGlobal("fetch", fn);
    await processTarget(claim(post.id)[0], { sleep: noSleep });
    expect(calls[0].body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh" });
    expect(calls[1].headers.authorization).toBe("Bearer new");
  });
});

it("demo accounts publish without network and #fail simulates errors", async () => {
  const dir2 = dir;
  const acct = addAccount("instagram", "demo");
  const m = addMedia(dir2);
  const ok = savePost({ caption: "fine", mediaIds: [m.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "ig_image", options: {} }] });
  const bad = savePost({ caption: "nope #fail", mediaIds: [m.id], mode: "now", scheduledAt: null, targets: [{ accountId: acct, contentType: "ig_image", options: {} }] });
  vi.stubGlobal("fetch", () => { throw new Error("no network in demo"); });
  await processTarget(claim(ok.id)[0], { sleep: noSleep });
  await processTarget(claim(bad.id)[0], { sleep: noSleep });
  expect(getPost(ok.id)!.status).toBe("published");
  expect(getPost(bad.id)!.status).toBe("failed");
});
