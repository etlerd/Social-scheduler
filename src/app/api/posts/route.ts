import { route, readJson } from "@/lib/api";
import { listPosts, listPostsPage, savePost, type PostView } from "@/lib/posts";
import type { PostInput } from "@/lib/types";

export const GET = route(async (req) => {
  const u = new URL(req.url);
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  const view = u.searchParams.get("view") as PostView | null;
  if (view) {
    return Response.json(
      listPostsPage({
        view,
        search: u.searchParams.get("q") ?? undefined,
        offset: Number(u.searchParams.get("offset") || 0),
        limit: Number(u.searchParams.get("limit") || 50),
      }),
    );
  }
  return Response.json({ posts: listPosts(from && to ? { from: Number(from), to: Number(to) } : {}) });
});

export const POST = route(async (req) => {
  const input = await readJson<PostInput>(req);
  return Response.json({ post: savePost(input) }, { status: 201 });
});
