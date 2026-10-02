import { route } from "@/lib/api";
import { listAccounts } from "@/lib/accounts";
import { config } from "@/lib/config";
import { igConfigured, igRedirectUri } from "@/lib/providers/instagram";
import { ytConfigured, ytRedirectUri } from "@/lib/providers/youtube";

export const GET = route(async () =>
  Response.json({
    accounts: listAccounts(),
    setup: {
      instagram: igConfigured(),
      youtube: ytConfigured(),
      demo: config.demoAccounts,
      publicUrl: config.publicUrl,
      redirectUris: { instagram: igRedirectUri(), youtube: ytRedirectUri() },
    },
  }),
);
