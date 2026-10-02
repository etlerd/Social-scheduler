import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { route } from "@/lib/api";
import { config } from "@/lib/config";
import { randomId } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";
import { EXT_BY_MIME, MIME_BY_EXT, insertMedia, listMedia, toMediaItem, type MediaRow } from "@/lib/media";
import { db } from "@/lib/db";
import { readVideoMeta } from "@/lib/mp4";
import { fmtBytes } from "@/lib/format";
import { invalidateStorage, storageReport, uploadAllowance } from "@/lib/storage";

export const GET = route(async () => Response.json({ media: listMedia() }));

function num(v: string | null): number | null {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Streams the raw request body to disk. Metadata comes in headers so large videos never sit in memory. */
export const POST = route(async (req) => {
  if (!req.body) throw new ApiError(400, "Empty upload");
  const originalName = decodeURIComponent(req.headers.get("x-file-name") || "upload").slice(0, 200);
  let mime = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!EXT_BY_MIME[mime]) mime = MIME_BY_EXT[path.extname(originalName).toLowerCase()] || mime;
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new ApiError(415, `Unsupported file type: ${mime || "unknown"}`);
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > config.maxUploadBytes) throw new ApiError(413, "File too large");
  invalidateStorage();
  const allowance = uploadAllowance();
  const noRoom = (size: number) => {
    const r = storageReport();
    return new ApiError(
      507,
      `Not enough storage: this file is ${fmtBytes(size)} but only ${fmtBytes(Math.max(0, allowance))} is free (${fmtBytes(r.used)} of ${fmtBytes(r.limit)} used). Free up space under Media → Storage.`,
      { storage: r },
    );
  };
  if (declared && declared > allowance) throw noRoom(declared);

  db(); // ensures the media directory exists
  const id = randomId(9);
  const fileName = `${randomId(16)}${ext}`;
  const dest = path.join(config.mediaDir, fileName);
  let size = 0;
  const limit = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > config.maxUploadBytes) cb(new ApiError(413, "File too large"));
      else if (size > allowance) cb(noRoom(size));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body as never), limit, fs.createWriteStream(dest));
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e instanceof ApiError ? e : new ApiError(400, "Upload interrupted");
  }
  if (!size) {
    fs.rmSync(dest, { force: true });
    throw new ApiError(400, "Empty upload");
  }
  const kind = mime.startsWith("video/") ? "video" : "image";
  let width = num(req.headers.get("x-width"));
  let height = num(req.headers.get("x-height"));
  let duration = num(req.headers.get("x-duration"));
  if (kind === "video" && (!width || !height || !duration) && (mime === "video/mp4" || mime === "video/quicktime")) {
    const meta = readVideoMeta(dest);
    width ??= meta?.width ?? null;
    height ??= meta?.height ?? null;
    duration ??= meta?.duration ?? null;
  }
  const row: MediaRow = {
    id,
    file_name: fileName,
    original_name: originalName,
    mime,
    size,
    width,
    height,
    duration,
    kind,
    created_at: Date.now(),
    purged_at: null,
  };
  insertMedia(row);
  invalidateStorage();
  return Response.json({ media: toMediaItem(row) }, { status: 201 });
});
