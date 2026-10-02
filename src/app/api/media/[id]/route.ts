import { route } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { deleteMedia, mediaInUse } from "@/lib/media";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  const n = mediaInUse(id);
  if (n) throw new ApiError(409, `Used by ${n} unpublished post${n > 1 ? "s" : ""}. Remove it there first.`);
  if (!deleteMedia(id)) throw new ApiError(404, "Not found");
  return Response.json({ ok: true });
});
