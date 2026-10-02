// Public media serving. Instagram fetches media from these URLs, so no auth; file names are
// 128-bit random. Supports Range requests for video seeking and platform fetchers.
import fs from "node:fs";
import { Readable } from "node:stream";
import { mediaFilePath, resolveMediaFile } from "@/lib/media";

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const hit = /^[\w-]+(\.thumb)?\.\w+$/.test(file) ? resolveMediaFile(file) : undefined;
  if (!hit) return new Response("Not found", { status: 404 });
  const { row, thumb } = hit;
  const p = mediaFilePath({ file_name: thumb ? row.thumb_file! : row.file_name });
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": thumb ? "image/jpeg" : row.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    const body = Readable.toWeb(fs.createReadStream(p, { start, end })) as unknown as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(fs.createReadStream(p)) as unknown as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
