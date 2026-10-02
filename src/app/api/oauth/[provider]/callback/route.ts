import { cookies } from "next/headers";
import { upsertAccount } from "@/lib/accounts";
import { isAuthed } from "@/lib/auth";
import { config } from "@/lib/config";
import { safeEqual } from "@/lib/crypto";
import { errorMessage } from "@/lib/errors";
import { igExchangeCode } from "@/lib/providers/instagram";
import { ytExchangeCode } from "@/lib/providers/youtube";

const back = (q: string) => Response.redirect(`${config.publicUrl}/accounts?${q}`, 302);

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!(await isAuthed())) return Response.redirect(`${config.publicUrl}/login`, 302);
  const { provider } = await params;
  const u = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(`oauth_${provider}`)?.value;
  jar.delete(`oauth_${provider}`);
  const err = u.searchParams.get("error_description") || u.searchParams.get("error");
  if (err) return back(`error=${encodeURIComponent(err)}`);
  const state = u.searchParams.get("state") || "";
  const code = u.searchParams.get("code");
  if (!expected || !safeEqual(state, expected) || !code) return back(`error=${encodeURIComponent("Login expired or was tampered with. Try again.")}`);

  try {
    if (provider === "instagram") {
      const r = await igExchangeCode(code);
      upsertAccount({
        platform: "instagram",
        mode: "live",
        externalId: r.userId,
        name: r.name,
        username: r.username,
        avatarUrl: r.avatarUrl,
        accessToken: r.accessToken,
        tokenExpiresAt: r.expiresAt,
        meta: { tokenIssuedAt: Date.now(), accountType: r.accountType },
      });
    } else if (provider === "youtube") {
      const r = await ytExchangeCode(code);
      upsertAccount({
        platform: "youtube",
        mode: "live",
        externalId: r.channelId,
        name: r.name,
        username: r.username,
        avatarUrl: r.avatarUrl,
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        tokenExpiresAt: r.expiresAt,
      });
    } else {
      return back("error=Unknown+provider");
    }
  } catch (e) {
    return back(`error=${encodeURIComponent(errorMessage(e))}`);
  }
  return back(`connected=${provider}`);
}
