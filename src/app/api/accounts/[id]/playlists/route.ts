import { route } from "@/lib/api";
import { getAccountRow } from "@/lib/accounts";
import { ApiError } from "@/lib/errors";
import { ytPlaylists } from "@/lib/providers/youtube";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const a = getAccountRow((await params).id);
  if (!a || a.platform !== "youtube") throw new ApiError(404, "Not a YouTube channel");
  if (a.mode === "demo") {
    return Response.json({ playlists: [{ id: "demo-1", title: "Tutorials" }, { id: "demo-2", title: "Behind the scenes" }] });
  }
  try {
    return Response.json({ playlists: await ytPlaylists(a) });
  } catch (e) {
    throw new ApiError(502, (e as Error).message);
  }
});
