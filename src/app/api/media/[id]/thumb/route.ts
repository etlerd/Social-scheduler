// Stores a small JPEG preview generated in the browser at upload time.
import fs from "node:fs";
import path from "node:path";
import { route } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { getMediaRow, mediaFilePath, setThumb } from "@/lib/media";

const MAX = 512 * 1024;

export const PUT = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const row = getMediaRow((await params).id);
  if (!row) throw new ApiError(404, "Not found");
  if ((req.headers.get("content-type") || "") !== "image/jpeg") throw new ApiError(415, "Thumbnail must be JPEG");
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > MAX) throw new ApiError(413, "Thumbnail too large");
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new ApiError(415, "Not a JPEG");
  const thumbFile = `${path.parse(row.file_name).name}.thumb.jpg`;
  fs.writeFileSync(mediaFilePath({ file_name: thumbFile }), buf);
  setThumb(row.id, thumbFile);
  return Response.json({ thumbUrl: `/media/${thumbFile}` });
});
