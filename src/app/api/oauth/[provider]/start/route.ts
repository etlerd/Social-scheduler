import { cookies } from "next/headers";
import { isAuthed } from "@/lib/auth";
import { config } from "@/lib/config";
import { randomId } from "@/lib/crypto";
import { igAuthorizeUrl, igConfigured } from "@/lib/providers/instagram";
import { ytAuthorizeUrl, ytConfigured } from "@/lib/providers/youtube";

export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!(await isAuthed())) return Response.redirect(`${config.publicUrl}/login`, 302);
  const { provider } = await params;
  const ok = provider === "instagram" ? igConfigured() : provider === "youtube" ? ytConfigured() : false;
  if (!ok) return Response.redirect(`${config.publicUrl}/accounts?error=${encodeURIComponent(`${provider} is not configured on the server`)}`, 302);
  const state = randomId(16);
  (await cookies()).set(`oauth_${provider}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });
  return Response.redirect(provider === "instagram" ? igAuthorizeUrl(state) : ytAuthorizeUrl(state), 302);
}
