import { describe, expect, it } from "vitest";
import { computeDispatchAt, countHashtags, mediaForTarget, tagsLength, validateTarget } from "./rules";
import type { ContentType, TargetOptions } from "./types";

const img = (o: Partial<{ id: string; mime: string; size: number; width: number; height: number }> = {}) => ({
  id: o.id ?? "i", mime: o.mime ?? "image/jpeg", size: o.size ?? 1000, width: o.width ?? 1080, height: o.height ?? 1080, duration: null, kind: "image" as const,
});
const vid = (o: Partial<{ id: string; duration: number; width: number; height: number; size: number; mime: string }> = {}) => ({
  id: o.id ?? "v", mime: o.mime ?? "video/mp4", size: o.size ?? 1000, width: o.width ?? 1080, height: o.height ?? 1920, duration: o.duration ?? 30, kind: "video" as const,
});

function v(ct: ContentType, media: any[], options: TargetOptions = {}, caption = "", extra: Record<string, any> = {}) {
  return validateTarget({ contentType: ct, options, caption, media, lookup: (id) => extra[id], scheduledAt: Date.now() + 3600_000, mode: "schedule" });
}
const errors = (issues: { level: string; message: string }[]) => issues.filter((i) => i.level === "error").map((i) => i.message);

describe("instagram rules", () => {
  it("accepts a square JPEG post", () => expect(errors(v("ig_image", [img()]))).toEqual([]));
  it("rejects PNG, oversize and out-of-range ratios", () => {
    expect(errors(v("ig_image", [img({ mime: "image/png" })]))[0]).toMatch(/JPEG/);
    expect(errors(v("ig_image", [img({ size: 9 * 1024 * 1024 })]))[0]).toMatch(/8 MB/);
    expect(errors(v("ig_image", [img({ width: 1080, height: 1920 })]))[0]).toMatch(/aspect ratio/);
  });
  it("carousel needs 2–10 items and checks video length", () => {
    expect(errors(v("ig_carousel", [img()]))).toContain("A carousel needs at least 2 items.");
    expect(errors(v("ig_carousel", Array.from({ length: 11 }, (_, i) => img({ id: `${i}` }))))).toContain("A carousel allows at most 10 items.");
    expect(errors(v("ig_carousel", [img(), vid({ duration: 90, width: 1080, height: 1080 })]))[0]).toMatch(/duration/);
  });
  it("reel limits", () => {
    expect(errors(v("ig_reel", [vid({ duration: 2 })]))[0]).toMatch(/between/);
    expect(errors(v("ig_reel", [vid({ duration: 16 * 60 })]))[0]).toMatch(/between/);
    expect(errors(v("ig_reel", [vid({ mime: "video/webm" })]))[0]).toMatch(/MP4 or MOV/);
    expect(errors(v("ig_reel", [img()]))).toContain("Add a video.");
  });
  it("story caption is a warning, not an error", () => {
    const r = v("ig_story", [vid()], {}, "hello");
    expect(errors(r)).toEqual([]);
    expect(r.some((i) => i.level === "warning")).toBe(true);
  });
  it("caption, hashtag limits", () => {
    expect(errors(v("ig_image", [img()], {}, "a".repeat(2201)))[0]).toMatch(/2,200/);
    expect(errors(v("ig_image", [img()], {}, Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ")))[0]).toMatch(/30 hashtags/);
    expect(countHashtags("a #one #two x#no")).toBe(2);
  });
});

it("validates an account's own caption instead of the shared one", () => {
  expect(errors(v("ig_image", [img()], { caption: "a".repeat(2201) }, "short"))[0]).toMatch(/2,200/);
  expect(errors(v("ig_image", [img()], { caption: "fine" }, "a".repeat(2201)))).toEqual([]);
});

describe("youtube rules", () => {
  it("requires a title and a video", () => {
    expect(errors(v("yt_video", []))).toEqual(expect.arrayContaining(["YouTube needs a title.", "Add a video."]));
  });
  it("short must be vertical and ≤ 3 min", () => {
    expect(errors(v("yt_short", [vid({ duration: 181 })], { title: "x" }))).toContain("Shorts must be 3 minutes or less.");
    expect(errors(v("yt_short", [vid({ width: 1920, height: 1080 })], { title: "x" }))).toContain("Shorts must be vertical or square.");
    expect(errors(v("yt_short", [vid()], { title: "x" }))).toEqual([]);
  });
  it("rejects angle brackets, long description, tag overflow, bad thumbnail", () => {
    expect(errors(v("yt_video", [vid()], { title: "a <b>" }))[0]).toMatch(/< or >/);
    expect(errors(v("yt_video", [vid()], { title: "t", useCaption: true }, "é".repeat(2600)))[0]).toMatch(/bytes/);
    expect(errors(v("yt_video", [vid()], { title: "t", tags: Array.from({ length: 60 }, () => "abcdefghi") }))[0]).toMatch(/500/);
    expect(errors(v("yt_video", [vid()], { title: "t", thumbnailMediaId: "th" }, "", { th: img({ size: 3 * 1024 * 1024 }) }))[0]).toMatch(/2 MB/);
  });
  it("live needs a schedule, not 'now'", () => {
    const r = validateTarget({ contentType: "yt_live", options: { title: "x" }, caption: "", media: [], lookup: () => undefined, scheduledAt: Date.now(), mode: "now" });
    expect(errors(r)).toContain("Live events need a scheduled start time.");
  });
  it("tag length counts quotes for multi-word tags", () => expect(tagsLength(["a b", "c"])).toBe(3 + 2 + 1 + 1));
});

describe("dispatch timing", () => {
  const now = 1_000_000_000_000;
  it("instagram dispatches at publish time", () => expect(computeDispatchAt("ig_reel", {}, now + 3600_000, now)).toBe(now + 3600_000));
  it("public future YouTube uploads dispatch immediately", () => expect(computeDispatchAt("yt_video", { privacy: "public" }, now + 3600_000, now)).toBe(now));
  it("unlisted YouTube waits (publishAt only works for public)", () =>
    expect(computeDispatchAt("yt_video", { privacy: "unlisted" }, now + 3600_000, now)).toBe(now + 3600_000));
  it("native scheduling can be disabled", () =>
    expect(computeDispatchAt("yt_short", { nativeSchedule: false }, now + 3600_000, now)).toBe(now + 3600_000));
  it("picks the first video for YouTube from mixed media", () => expect(mediaForTarget("yt_video", [img(), vid({ id: "x" }), vid({ id: "y" })])[0].id).toBe("x"));
});

it("past time is an error", () => {
  const r = validateTarget({ contentType: "ig_image", options: {}, caption: "", media: [img()], lookup: () => undefined, scheduledAt: Date.now() - 3600_000, mode: "schedule" });
  expect(errors(r)).toContain("Scheduled time is in the past.");
});
