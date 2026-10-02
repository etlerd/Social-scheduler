import { beforeEach, describe, expect, it } from "vitest";
import { addAccount, addMedia, setupTestEnv } from "./test-setup";
import { savePost } from "./posts";
import { db } from "./db";
import fs from "node:fs";
import { mediaFilePath } from "./media";
import { deletableIds, invalidateStorage, storageReport, unusedMedia, reserveBytes } from "./storage";

const MB = 1024 * 1024;
let dir: string;
beforeEach(() => {
  dir = setupTestEnv();
  invalidateStorage();
});

describe("storage report", () => {
  it("splits usage by what holds each file", () => {
    process.env.STORAGE_LIMIT_GB = "1";
    const ig = addAccount("instagram");
    const waiting = addMedia(dir, {}, 3 * MB);
    const failedOnly = addMedia(dir, {}, 2 * MB);
    const unused = addMedia(dir, {}, 1 * MB);
    savePost({ caption: "", mediaIds: [waiting.id], mode: "draft", scheduledAt: null, targets: [{ accountId: ig, contentType: "ig_image", options: {} }] });
    const f = savePost({ caption: "", mediaIds: [failedOnly.id], mode: "now", scheduledAt: null, targets: [{ accountId: ig, contentType: "ig_image", options: {} }] });
    db().prepare("UPDATE post_targets SET status = 'failed' WHERE post_id = ?").run(f.id);
    const r = storageReport();
    expect(r.breakdown.waiting).toBe(3 * MB);
    expect(r.breakdown.failed).toBe(2 * MB);
    expect(r.breakdown.unused).toBe(1 * MB);
    expect(r.breakdown.app).toBeGreaterThanOrEqual(0); // database (in-memory in tests)
    expect(r.level).toBe("ok");
    expect(r.largest.map((m) => m.heldBy)).toEqual(["waiting", "failed", "unused"]);
    expect(unusedMedia().map((m) => m.id)).toEqual([unused.id]);
  });

  it("never offers held files for deletion", () => {
    const ig = addAccount("instagram");
    const held = addMedia(dir);
    const thumb = addMedia(dir);
    const free = addMedia(dir);
    savePost({ caption: "", mediaIds: [held.id], mode: "draft", scheduledAt: null, targets: [{ accountId: ig, contentType: "ig_image", options: {} }] });
    const yt = addAccount("youtube");
    savePost({ caption: "", mediaIds: [], mode: "draft", scheduledAt: null, targets: [{ accountId: yt, contentType: "yt_live", options: { title: "t", thumbnailMediaId: thumb.id } }] });
    expect(deletableIds([held.id, thumb.id, free.id])).toEqual([free.id]);
  });

  it("raises the level as the 5 GB budget fills", () => {
    process.env.STORAGE_LIMIT_GB = "5";
    const GB = 1024 ** 3;
    // Sparse files: real sizes on stat without writing gigabytes.
    const big = (bytes: number) => fs.truncateSync(mediaFilePath(addMedia(dir, {}, 10)), Math.round(bytes));
    big(3.5 * GB); // 70%
    expect(storageReport().level).toBe("ok");
    big(0.6 * GB); // 82%
    invalidateStorage();
    expect(storageReport().level).toBe("warn");
    big(0.7 * GB); // 96%
    invalidateStorage();
    expect(storageReport().level).toBe("critical");
    big(0.15 * GB); // under 100 MB left
    invalidateStorage();
    const r = storageReport();
    expect(r.level).toBe("full");
    expect(r.free).toBeLessThanOrEqual(reserveBytes());
    process.env.STORAGE_LIMIT_GB = "5";
  });
});
