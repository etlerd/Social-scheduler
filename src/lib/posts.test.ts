import { beforeEach, describe, expect, it } from "vitest";
import { addAccount, addMedia, setupTestEnv } from "./test-setup";
import { deletePost, getPost, reschedulePost, retryPost, savePost } from "./posts";
import { ApiError } from "./errors";
import { db } from "./db";
import { mediaInUse } from "./media";

let dir: string;
beforeEach(() => {
  dir = setupTestEnv();
});

describe("savePost", () => {
  it("creates a scheduled multi-platform post with per-target dispatch times", () => {
    const ig = addAccount("instagram");
    const yt = addAccount("youtube");
    const v = addMedia(dir, { kind: "video" });
    const at = Date.now() + 3600_000;
    const post = savePost({
      caption: "hello",
      mediaIds: [v.id],
      mode: "schedule",
      scheduledAt: at,
      targets: [
        { accountId: ig, contentType: "ig_reel", options: {} },
        { accountId: yt, contentType: "yt_short", options: { title: "Hi", privacy: "public" } },
      ],
    });
    expect(post.status).toBe("scheduled");
    const byType = Object.fromEntries(post.targets.map((t) => [t.contentType, t]));
    expect(byType.ig_reel.dispatchAt).toBe(at);
    expect(byType.yt_short.dispatchAt!).toBeLessThanOrEqual(Date.now());
    expect(mediaInUse(v.id)).toBe(1);
  });

  it("rejects invalid content with per-account issues, but allows it as a draft", () => {
    const ig = addAccount("instagram");
    const input = { caption: "", mediaIds: [], mode: "schedule" as const, scheduledAt: Date.now() + 3600_000, targets: [{ accountId: ig, contentType: "ig_image" as const, options: {} }] };
    try {
      savePost(input);
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(422);
      expect(((e as ApiError).details as any).issues[ig][0].message).toBe("Add a photo.");
    }
    expect(savePost({ ...input, mode: "draft" }).status).toBe("draft");
  });

  it("rejects a content type from the wrong platform", () => {
    const ig = addAccount("instagram");
    expect(() => savePost({ caption: "", mediaIds: [], mode: "draft", scheduledAt: null, targets: [{ accountId: ig, contentType: "yt_video", options: {} }] })).toThrow(/Invalid content type/);
  });

  it("locks editing once a target is publishing, and blocks delete during publish", () => {
    const ig = addAccount("instagram");
    const m = addMedia(dir);
    const p = savePost({ caption: "", mediaIds: [m.id], mode: "now", scheduledAt: null, targets: [{ accountId: ig, contentType: "ig_image", options: {} }] });
    db().prepare("UPDATE post_targets SET status = 'publishing'").run();
    expect(getPost(p.id)!.editable).toBe(false);
    expect(() => savePost({ caption: "x", mediaIds: [m.id], mode: "draft", scheduledAt: null, targets: [] }, p.id)).toThrow(/can't be edited/);
    expect(() => deletePost(p.id)).toThrow(/publishing/);
  });

  it("reschedules and retries", () => {
    const ig = addAccount("instagram");
    const m = addMedia(dir);
    const p = savePost({ caption: "", mediaIds: [m.id], mode: "schedule", scheduledAt: Date.now() + 3600_000, targets: [{ accountId: ig, contentType: "ig_image", options: {} }] });
    const later = Date.now() + 7200_000;
    expect(reschedulePost(p.id, later).targets[0].dispatchAt).toBe(later);
    expect(() => reschedulePost(p.id, Date.now() - 3600_000)).toThrow(/past/);
    db().prepare("UPDATE post_targets SET status = 'failed', error = 'boom', attempts = 3").run();
    const r = retryPost(p.id);
    expect(r.targets[0].status).toBe("scheduled");
    expect(r.targets[0].attempts).toBe(0);
  });
});

describe("media cleanup after publishing", () => {
  it("deletes files only when every post using them is done", async () => {
    const { purgePublishedMedia, getMediaRow, mediaFilePath, listMedia } = await import("./media");
    const fs = await import("node:fs");
    const ig = addAccount("instagram");
    const yt = addAccount("youtube");
    const shared = addMedia(dir, { kind: "video" });
    const thumb = addMedia(dir);
    const libraryOnly = addMedia(dir);
    const a = savePost({ caption: "", mediaIds: [shared.id], mode: "now", scheduledAt: null, targets: [{ accountId: ig, contentType: "ig_reel", options: {} }] });
    const b = savePost({ caption: "", mediaIds: [shared.id], mode: "now", scheduledAt: null, targets: [{ accountId: yt, contentType: "yt_video", options: { title: "t", thumbnailMediaId: thumb.id } }] });

    db().prepare("UPDATE post_targets SET status = 'published' WHERE post_id = ?").run(a.id);
    expect(purgePublishedMedia(a.id)).toBe(0); // post b still needs the video
    expect(fs.existsSync(mediaFilePath(shared))).toBe(true);

    db().prepare("UPDATE post_targets SET status = 'failed' WHERE post_id = ?").run(b.id);
    expect(purgePublishedMedia()).toBe(0); // failed posts keep media for retry

    db().prepare("UPDATE post_targets SET status = 'platform_scheduled' WHERE post_id = ?").run(b.id);
    expect(purgePublishedMedia()).toBe(2); // video + thumbnail
    expect(fs.existsSync(mediaFilePath(shared))).toBe(false);
    expect(getMediaRow(shared.id)!.purged_at).not.toBeNull();
    expect(fs.existsSync(mediaFilePath(libraryOnly))).toBe(true);
    expect(listMedia().map((m) => m.id)).toEqual([libraryOnly.id]);
    expect(getPost(a.id)!.media[0].purged).toBe(true);
    expect(() => savePost({ caption: "", mediaIds: [shared.id], mode: "draft", scheduledAt: null, targets: [] })).toThrow(/deleted after it was published/);
  });
});

describe("SQL-side listing", () => {
  it("computes the same status as aggregateStatus for every target mix", async () => {
    const { aggregateStatus, listPostsPage } = await import("./posts");
    const ig = addAccount("instagram");
    const yt = addAccount("youtube");
    const statuses = ["draft", "scheduled", "publishing", "published", "platform_scheduled", "failed"] as const;
    const expected = new Map<string, string>();
    for (const a of statuses) {
      for (const b of [...statuses, null]) {
        const p = savePost({ caption: `${a}-${b}`, mediaIds: [], mode: "draft", scheduledAt: null, targets: [{ accountId: ig, contentType: "ig_image", options: {} }, ...(b ? [{ accountId: yt, contentType: "yt_live" as const, options: { title: "t" } }] : [])] });
        const ts = getPost(p.id)!.targets;
        db().prepare("UPDATE post_targets SET status = ? WHERE id = ?").run(a, ts[0].id);
        if (b) db().prepare("UPDATE post_targets SET status = ? WHERE id = ?").run(b, ts[1].id);
        expected.set(p.id, aggregateStatus(b ? [a, b] : [a]));
      }
    }
    const views = { upcoming: ["scheduled", "publishing"], drafts: ["draft"], published: ["published"], failed: ["failed", "partial"] } as const;
    for (const [view, sts] of Object.entries(views)) {
      const got = new Set(listPostsPage({ view: view as never, limit: 200 }).posts.map((p) => p.id));
      const want = new Set([...expected].filter(([, s]) => (sts as readonly string[]).includes(s)).map(([id]) => id));
      expect(got).toEqual(want);
    }
    const { overview } = await import("./posts");
    const o = overview();
    for (const v of ["upcoming", "drafts", "published", "failed", "all"] as const) expect(o.counts[v]).toBe(listPostsPage({ view: v }).total);
  });

  it("searches captions and YouTube titles, with LIKE wildcards escaped", async () => {
    const { listPostsPage } = await import("./posts");
    const yt = addAccount("youtube");
    savePost({ caption: "100% pasta", mediaIds: [], mode: "draft", scheduledAt: null, targets: [] });
    savePost({ caption: "other", mediaIds: [], mode: "draft", scheduledAt: null, targets: [{ accountId: yt, contentType: "yt_live", options: { title: "Pasta live" } }] });
    savePost({ caption: "1000 things", mediaIds: [], mode: "draft", scheduledAt: null, targets: [] });
    expect(listPostsPage({ view: "all", search: "pasta" }).total).toBe(2);
    expect(listPostsPage({ view: "all", search: "100%" }).posts.map((p) => p.caption)).toEqual(["100% pasta"]);
  });
});
