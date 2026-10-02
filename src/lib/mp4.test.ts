import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseMoov, readVideoMeta } from "./mp4";

const box = (type: string, body: Buffer) => {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(body.length + 8);
  h.write(type, 4, "latin1");
  return Buffer.concat([h, body]);
};

function mvhd(timescale: number, duration: number) {
  const b = Buffer.alloc(100);
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration, 16);
  return box("mvhd", b);
}

function tkhd(w: number, h: number, rotate90 = false) {
  const b = Buffer.alloc(84);
  const m = 24 + 16; // v0 header fields, then reserved/layer/alt group/volume
  const one = 65536;
  const matrix = rotate90 ? [0, one, 0, -one, 0, 0, 0, 0, 0x40000000] : [one, 0, 0, 0, one, 0, 0, 0, 0x40000000];
  matrix.forEach((v, i) => b.writeInt32BE(v, m + i * 4));
  b.writeUInt32BE(w * one, m + 36);
  b.writeUInt32BE(h * one, m + 40);
  return box("tkhd", b);
}

describe("mp4 metadata", () => {
  it("reads duration and size, skipping audio tracks", () => {
    const moov = Buffer.concat([mvhd(1000, 12500), box("trak", tkhd(0, 0)), box("trak", tkhd(1920, 1080))]);
    expect(parseMoov(moov)).toEqual({ duration: 12.5, width: 1920, height: 1080 });
  });
  it("swaps dimensions for rotated (phone) video", () => {
    expect(parseMoov(Buffer.concat([mvhd(600, 600), box("trak", tkhd(1920, 1080, true))]))).toMatchObject({ width: 1080, height: 1920 });
  });
  it("finds moov after mdat in a file", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mp4-")), "a.mp4");
    fs.writeFileSync(f, Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("mdat", Buffer.alloc(5000)), box("moov", Buffer.concat([mvhd(30, 90), box("trak", tkhd(720, 1280))]))]));
    expect(readVideoMeta(f)).toEqual({ duration: 3, width: 720, height: 1280 });
  });
  it("returns null for garbage", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mp4-")), "b.mp4");
    fs.writeFileSync(f, Buffer.from("not a video at all"));
    expect(readVideoMeta(f)).toBeNull();
  });
});
