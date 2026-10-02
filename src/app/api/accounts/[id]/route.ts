import { route } from "@/lib/api";
import { deleteAccount, pendingTargetCount } from "@/lib/accounts";
import { ApiError } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => Response.json({ pending: pendingTargetCount((await params).id) }));

export const DELETE = route<Ctx>(async (_req, { params }) => {
  if (!deleteAccount((await params).id)) throw new ApiError(404, "Not found");
  return Response.json({ ok: true });
});
