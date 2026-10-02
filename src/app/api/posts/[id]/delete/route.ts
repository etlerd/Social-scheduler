// POST alias for DELETE, used by navigator.sendBeacon when the tab closes during an undo window.
import { route } from "@/lib/api";
import { deletePost } from "@/lib/posts";

export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  deletePost((await params).id);
  return Response.json({ ok: true });
});
