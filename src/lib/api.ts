import { gzipSync } from "node:zlib";
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
      return await compress(req, await fn(req, ctx));
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

/** Next compresses pages but not route-handler JSON; lists of posts shrink ~10x with gzip. */
async function compress(req: Request, res: Response): Promise<Response> {
  if (!/\bgzip\b/.test(req.headers.get("accept-encoding") || "")) return res;
  if (!(res.headers.get("content-type") || "").includes("application/json") || res.headers.has("content-encoding")) return res;
  const body = Buffer.from(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  headers.append("Vary", "Accept-Encoding");
  if (body.length < 1024) return new Response(body, { status: res.status, headers });
  const gz = gzipSync(body, { level: 6 });
  headers.set("Content-Encoding", "gzip");
  headers.set("Content-Length", String(gz.length));
  return new Response(gz, { status: res.status, headers });
}
