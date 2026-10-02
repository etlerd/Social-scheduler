import { route, readJson } from "@/lib/api";
import { listPosts, savePost } from "@/lib/posts";
import type { PostInput } from "@/lib/types";

export const GET = route(async (req) => {
  const u = new URL(req.url);
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  return Response.json({ posts: listPosts(from && to ? { from: Number(from), to: Number(to) } : {}) });
});

export const POST = route(async (req) => {
  const input = await readJson<PostInput>(req);
  return Response.json({ post: savePost(input) }, { status: 201 });
});
