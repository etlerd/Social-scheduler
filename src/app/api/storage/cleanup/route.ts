// Deletes library files that no unpublished post uses. Files held by scheduled, draft or
// failed posts are never touched, whatever the client sends.
import { route, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { deleteMedia } from "@/lib/media";
import { deletableIds, invalidateStorage, storageReport, unusedMedia } from "@/lib/storage";

export const POST = route(async (req) => {
  const { ids, all } = await readJson<{ ids?: string[]; all?: boolean }>(req);
  const unused = unusedMedia();
  const wanted = all ? unused.map((m) => m.id) : ids;
  if (!Array.isArray(wanted) || !wanted.length) throw new ApiError(400, "Nothing selected");
  const allowed = deletableIds(wanted);
  const sizes = new Map(unused.map((m) => [m.id, m.size]));
  let freed = 0;
  for (const id of allowed) if (deleteMedia(id)) freed += sizes.get(id) ?? 0;
  invalidateStorage();
  return Response.json({ deleted: allowed.length, skipped: wanted.length - allowed.length, freed, storage: storageReport() });
});
