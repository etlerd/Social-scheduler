import { route, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { deletePost, getPost, reschedulePost, savePost } from "@/lib/posts";
import type { PostInput } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const post = getPost((await params).id, true);
  if (!post) throw new ApiError(404, "Post not found");
  return Response.json({ post });
});

export const PUT = route<Ctx>(async (req, { params }) => {
  const input = await readJson<PostInput>(req);
  return Response.json({ post: savePost(input, (await params).id) });
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { scheduledAt } = await readJson<{ scheduledAt?: number }>(req);
  if (typeof scheduledAt !== "number") throw new ApiError(400, "scheduledAt required");
  return Response.json({ post: reschedulePost((await params).id, scheduledAt) });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  deletePost((await params).id);
  return Response.json({ ok: true });
});
