import { route } from "@/lib/api";
import { retryPost } from "@/lib/posts";

export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  return Response.json({ post: retryPost((await params).id) });
});
