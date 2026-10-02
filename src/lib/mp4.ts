// Reads duration and display dimensions from MP4/MOV (ISO BMFF) without ffmpeg.
// Used when the browser couldn't decode the video to report them itself.
import fs from "node:fs";

export interface VideoMeta {
  width: number | null;
  height: number | null;
  duration: number | null;
}

function* boxes(buf: Buffer, start: number, end: number): Generator<{ type: string; body: number; end: number }> {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || p + size > end) return;
    yield { type, body: p + header, end: p + size };
    p += size;
  }
}

export function parseMoov(moov: Buffer): VideoMeta {
  const out: VideoMeta = { width: null, height: null, duration: null };
  for (const b of boxes(moov, 0, moov.length)) {
    if (b.type === "mvhd") {
      const v = moov[b.body];
      const timescale = moov.readUInt32BE(b.body + (v === 1 ? 20 : 12));
      const dur = v === 1 ? Number(moov.readBigUInt64BE(b.body + 24)) : moov.readUInt32BE(b.body + 16);
      if (timescale) out.duration = dur / timescale;
    }
    if (b.type === "trak" && out.width == null) {
      for (const t of boxes(moov, b.body, b.end)) {
        if (t.type !== "tkhd") continue;
        const v = moov[t.body];
        const matrix = t.body + (v === 1 ? 36 : 24) + 16;
        const a = moov.readInt32BE(matrix) / 65536;
        const bb = moov.readInt32BE(matrix + 4) / 65536;
        const w = moov.readUInt32BE(matrix + 36) / 65536;
        const h = moov.readUInt32BE(matrix + 40) / 65536;
        if (w > 0 && h > 0) {
          const rotated = Math.abs(a) < 0.01 && Math.abs(Math.abs(bb) - 1) < 0.01;
          out.width = Math.round(rotated ? h : w);
          out.height = Math.round(rotated ? w : h);
        }
      }
    }
  }
  return out;
}

export function readVideoMeta(path: string): VideoMeta | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(path, "r");
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(16);
    let p = 0;
    while (p + 8 <= size) {
      fs.readSync(fd, head, 0, 16, p);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      let header = 8;
      if (boxSize === 1) {
        boxSize = Number(head.readBigUInt64BE(8));
        header = 16;
      } else if (boxSize === 0) boxSize = size - p;
      if (boxSize < header) return null;
      if (type === "moov") {
        if (boxSize > 64 * 1024 * 1024) return null;
        const moov = Buffer.alloc(boxSize - header);
        fs.readSync(fd, moov, 0, moov.length, p + header);
        return parseMoov(moov);
      }
      p += boxSize;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
