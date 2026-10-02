import { denyUnlessAuthed } from "./auth";
import { ApiError, errorMessage } from "./errors";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler with auth and uniform JSON error handling. */
export function route<C>(fn: Handler<C>, opts: { auth?: boolean } = {}): Handler<C> {
  return async (req, ctx) => {
    if (opts.auth !== false) {
      const deny = await denyUnlessAuthed();
      if (deny) return deny;
    }
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return Response.json({ error: e.message, details: e.details }, { status: e.status });
      }
      console.error(e);
      return Response.json({ error: errorMessage(e) }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}
